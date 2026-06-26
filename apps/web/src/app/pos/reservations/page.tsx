'use client';

// apps/web/src/app/pos/reservations/page.tsx
//
// Sprint 9.2 — Reservation management page.
//
// Two views:
//   - Calendar (default): a 7-day strip starting at the picked date. Each
//     day cell shows a count of bookings. Click a day to drill into the list.
//   - List: a vertical list of reservations for the selected date, with
//     status filters and per-row actions (seat / cancel / no-show).
//
// Tabs toggle between the two views. New reservation opens a dialog
// with date / time / party size / customer name+phone / duration / table.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, type Reservation, type ReservationStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';

type ViewMode = 'calendar' | 'list';
type StatusFilter = 'ALL' | ReservationStatus;

interface FormState {
  customerName: string;
  customerPhone: string;
  partySize: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  durationMinutes: number;
  tableNumber: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  customerName: '',
  customerPhone: '',
  partySize: 2,
  date: '',
  time: '19:00',
  durationMinutes: 90,
  tableNumber: '',
  notes: '',
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  BOOKED: 'Diterima',
  SEATED: 'Duduk',
  COMPLETED: 'Selesai',
  CANCELLED: 'Batal',
  NO_SHOW: 'Tidak Datang',
};

const STATUS_TONE: Record<ReservationStatus, 'success' | 'muted' | 'warning' | 'danger' | 'info'> = {
  BOOKED: 'info',
  SEATED: 'success',
  COMPLETED: 'muted',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
};

function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDateTime(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:mm → ISO with +07:00 offset
  return `${date}T${time}:00+07:00`;
}

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDayLabel(iso: string): { weekday: string; day: string; month: string } {
  const d = new Date(iso + 'T00:00:00+07:00');
  return {
    weekday: d.toLocaleDateString('id-ID', { weekday: 'short' }),
    day: d.toLocaleDateString('id-ID', { day: '2-digit' }),
    month: d.toLocaleDateString('id-ID', { month: 'short' }),
  };
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 p-6 text-neutral-500 dark:text-neutral-400 text-sm">Memuat…</div>
    }>
      <ReservationsPageContent />
    </Suspense>
  );
}

function ReservationsPageContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [view, setView] = useState<ViewMode>('calendar');
  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  // Day counts (for the calendar strip)
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({});
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Load reservations for the selected date
  const refresh = useCallback(async (date: string, status: StatusFilter) => {
    setLoading(true);
    try {
      const res = await api.listReservations({
        date,
        ...(status !== 'ALL' ? { status } : {}),
      });
      setReservations(res.data || []);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal memuat reservasi');
    } finally {
      setLoading(false);
    }
  }, []);

  // Compute the 7-day window for the calendar strip
  const weekDays = useMemo(() => {
    const out: string[] = [];
    const base = new Date(selectedDate + 'T00:00:00+07:00');
    for (let i = -3; i <= 3; i++) {
      const d = new Date(base.getTime() + i * 86400 * 1000);
      out.push(isoFromDate(d));
    }
    return out;
  }, [selectedDate]);

  // Load counts for the 7-day window
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          weekDays.map((d) =>
            api
              .listReservations({ date: d })
              .then((r) => ({ d, count: r.data?.length ?? 0 }))
              .catch(() => ({ d, count: 0 })),
          ),
        );
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const r of results) map[r.d] = r.count;
        setDayCounts(map);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekDays]);

  // Refresh the reservation list when date/status change
  useEffect(() => {
    void refresh(selectedDate, statusFilter);
  }, [refresh, selectedDate, statusFilter]);

  // When the form opens, seed the date and load availability
  useEffect(() => {
    if (!formOpen) return;
    if (!form.date) {
      setForm((f) => ({ ...f, date: selectedDate }));
    }
    if (!form.date || !form.partySize) {
      setAvailableSlots([]);
      return;
    }
    setSlotsLoading(true);
    api
      .getReservationAvailability({
        date: form.date,
        partySize: form.partySize,
      })
      .then((r) => {
        setAvailableSlots(r.data?.slots ?? []);
      })
      .catch(() => {
        setAvailableSlots([]);
      })
      .finally(() => setSlotsLoading(false));
  }, [formOpen, form.date, form.partySize]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, date: selectedDate });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!form.customerName.trim() || !form.customerPhone.trim()) {
      toast.error('Nama dan nomor HP wajib diisi');
      return;
    }
    if (!form.date || !form.time) {
      toast.error('Tanggal & jam wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const reservedAt = buildDateTime(form.date, form.time);
      await api.createReservation({
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        partySize: form.partySize,
        reservedAt,
        durationMinutes: form.durationMinutes,
        tableNumber: form.tableNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success('Reservasi dibuat');
      setFormOpen(false);
      void refresh(selectedDate, statusFilter);
      // Also bump the day count
      setDayCounts((c) => ({ ...c, [form.date]: (c[form.date] ?? 0) + 1 }));
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : e?.message || 'Gagal menyimpan';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function doSeat(r: Reservation) {
    setActionId(r.id);
    try {
      await api.seatReservation(r.id, {});
      toast.success('Tamu sudah duduk');
      void refresh(selectedDate, statusFilter);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menandai duduk');
    } finally {
      setActionId(null);
    }
  }

  async function doCancel(r: Reservation) {
    const reason = window.prompt('Alasan pembatalan?');
    if (!reason) return;
    setActionId(r.id);
    try {
      await api.cancelReservation(r.id, reason);
      toast.success('Reservasi dibatalkan');
      void refresh(selectedDate, statusFilter);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal membatalkan');
    } finally {
      setActionId(null);
    }
  }

  async function doNoShow(r: Reservation) {
    if (!window.confirm(`Tandai "${r.customerName}" sebagai tidak datang?`)) return;
    setActionId(r.id);
    try {
      await api.noShowReservation(r.id);
      toast.success('Ditandai tidak datang');
      void refresh(selectedDate, statusFilter);
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menandai');
    } finally {
      setActionId(null);
    }
  }

  if (!user) {
    return (
      <div className="flex-1 p-6 text-neutral-500 dark:text-neutral-400 text-sm">Memuat sesi…</div>
    );
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-5xl mx-auto w-full overflow-y-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Reservasi Meja</h1>
          <p className="text-xs text-neutral-500">
            Catat booking tamu untuk tanggal dan jam tertentu. Klik tanggal untuk lihat detail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setView('calendar')}
              className={cn(
                'h-8 px-3 text-xs rounded',
                view === 'calendar' ? 'bg-red-600 text-neutral-900 dark:text-white' : 'text-neutral-700 dark:text-neutral-300',
              )}
            >
              📅 Kalender
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'h-8 px-3 text-xs rounded',
                view === 'list' ? 'bg-red-600 text-neutral-900 dark:text-white' : 'text-neutral-700 dark:text-neutral-300',
              )}
            >
              📋 Daftar
            </button>
          </div>
          <Button onClick={openCreate}>+ Reservasi Baru</Button>
        </div>
      </div>

      {/* Calendar strip */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">7 Hari</CardTitle>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(selectedDate + 'T00:00:00+07:00');
                  d.setDate(d.getDate() - 7);
                  setSelectedDate(isoFromDate(d));
                }}
                className="h-8 px-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:bg-neutral-800 rounded"
                aria-label="Minggu sebelumnya"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(todayISO())}
                className="h-8 px-3 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-800"
              >
                Hari ini
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(selectedDate + 'T00:00:00+07:00');
                  d.setDate(d.getDate() + 7);
                  setSelectedDate(isoFromDate(d));
                }}
                className="h-8 px-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:bg-neutral-800 rounded"
                aria-label="Minggu berikutnya"
              >
                ›
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5">
            {weekDays.map((d) => {
              const label = formatDayLabel(d);
              const isSelected = d === selectedDate;
              const isToday = d === todayISO();
              const count = dayCounts[d] ?? 0;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={cn(
                    'flex flex-col items-center justify-center py-3 rounded-lg transition-colors text-center',
                    isSelected
                      ? 'bg-red-600 text-neutral-900 dark:text-white'
                      : isToday
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 ring-1 ring-red-500/40'
                        : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:bg-neutral-800',
                  )}
                >
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    {label.weekday}
                  </span>
                  <span className="text-lg font-semibold leading-none mt-1">{label.day}</span>
                  <span className="text-[10px] opacity-80 mt-1">
                    {label.month}
                  </span>
                  {count > 0 ? (
                    <span
                      className={cn(
                        'mt-1 text-[10px] px-1.5 rounded-full',
                        isSelected
                          ? 'bg-white/20 text-neutral-900 dark:text-white'
                          : 'bg-red-500/20 text-red-300',
                      )}
                    >
                      {count} booking
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Status filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Filter status:</span>
        {(['ALL', 'BOOKED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as StatusFilter[]).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'h-7 px-3 text-xs rounded-full border transition-colors',
                statusFilter === s
                  ? 'bg-red-600 text-neutral-900 dark:text-white border-red-600'
                  : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:border-neutral-700',
              )}
            >
              {s === 'ALL' ? 'Semua' : STATUS_LABEL[s]}
            </button>
          ),
        )}
        <div className="ml-auto text-xs text-neutral-500">
          {formatDayLabel(selectedDate).weekday}, {formatDayLabel(selectedDate).day}{' '}
          {formatDayLabel(selectedDate).month} {selectedDate.slice(0, 4)}
        </div>
      </div>

      {/* Reservation list (used by both views) */}
      {loading ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Memuat…</p>
      ) : reservations.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Tidak ada reservasi untuk tanggal ini.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reservations.map((r) => {
            const isActioning = actionId === r.id;
            return (
              <Card key={r.id}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                          {r.customerName}
                        </div>
                        <Badge tone={STATUS_TONE[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                        {r.tableNumber ? (
                          <Badge tone="muted">Meja {r.tableNumber}</Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-neutral-500 mt-1 flex flex-wrap gap-x-3">
                        <span>📞 <span className="font-mono">{r.customerPhone}</span></span>
                        <span>🕐 {formatTimeShort(r.reservedAt)} · {r.durationMinutes} mnt</span>
                        <span>👥 {r.partySize} orang</span>
                        {r.orderId ? <span>🧾 Order terpasang</span> : null}
                      </div>
                      {r.notes ? (
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5 whitespace-pre-wrap break-words">
                          📝 {r.notes}
                        </div>
                      ) : null}
                    </div>
                    {r.status === 'BOOKED' ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={isActioning}
                          onClick={() => doSeat(r)}
                        >
                          Duduk
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActioning}
                          onClick={() => doNoShow(r)}
                        >
                          Tidak Datang
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isActioning}
                          onClick={() => doCancel(r)}
                        >
                          Batal
                        </Button>
                      </div>
                    ) : null}
                    {r.status === 'SEATED' ? (
                      <Badge tone="success">Siap dilayani</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Calendar view: extra tip */}
      {view === 'calendar' && reservations.length > 0 ? (
        <p className="text-xs text-neutral-500 text-center">
          Tip: pindah ke tab <strong>Daftar</strong> untuk aksi lengkap.
        </p>
      ) : null}

      {/* New reservation dialog */}
      <Dialog open={formOpen} onOpenChange={(v) => !saving && setFormOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div>
              <DialogTitle>Reservasi Baru</DialogTitle>
              <p className="text-xs text-neutral-500 mt-1">
                Slot di bawah adalah jam yang masih tersedia.
              </p>
            </div>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Nama *</label>
                  <Input
                    value={form.customerName}
                    onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                    placeholder="Nama tamu"
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Nomor HP *</label>
                  <Input
                    inputMode="tel"
                    value={form.customerPhone}
                    onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                    placeholder="0812…"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Tanggal *</label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Jam *</label>
                  <Input
                    type="time"
                    value={form.time}
                    onChange={(e) => setForm({ ...form, time: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Orang *</label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={form.partySize}
                    onChange={(e) =>
                      setForm({ ...form, partySize: Math.max(1, parseInt(e.target.value, 10) || 1) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Durasi (mnt)</label>
                  <Input
                    type="number"
                    min={15}
                    max={360}
                    value={form.durationMinutes}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        durationMinutes: Math.max(15, parseInt(e.target.value, 10) || 90),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">No. Meja (opsional)</label>
                  <Input
                    value={form.tableNumber}
                    onChange={(e) => setForm({ ...form, tableNumber: e.target.value })}
                    placeholder="contoh: 5 / VIP-1"
                  />
                </div>
              </div>
              {availableSlots.length > 0 ? (
                <div>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">
                    Slot tersedia ({slotsLoading ? '…' : `${availableSlots.length}`})
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSlots.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForm({ ...form, time: s })}
                        className={cn(
                          'h-8 px-2 text-xs rounded border',
                          form.time === s
                            ? 'bg-red-600 text-neutral-900 dark:text-white border-red-600'
                            : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:border-neutral-700',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : slotsLoading ? null : (
                <p className="text-xs text-neutral-500">
                  Tidak ada slot otomatis (semua terisi / lewat dari jam buka).
                </p>
              )}
              <div>
                <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">Catatan</label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Alergi, acara, permintaan khusus…"
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.customerName.trim() || !form.customerPhone.trim()}
            >
              {saving ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
