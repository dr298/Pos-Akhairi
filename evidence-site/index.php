<?php
/**
 * pos-uat.akhairi.com — Full QA Evidence
 * Generated from Playwright test results (full-qa-results.json + user-journeys.json)
 * URL: http://100.125.92.122:8089/
 *
 * Auto-refreshes every 30s if data file changes.
 */

declare(strict_types=1);

$BASE = __DIR__;
$RESULTS_FILE = $BASE . '/data/full-qa-results.json';
$JOURNEYS_FILE = $BASE . '/data/user-journeys.json';
$SCREENSHOTS_DIR = $BASE . '/screenshots';
$JOURNEYS_SHOTS_DIR = $BASE . '/journeys';
// journeys screenshots go to same dir (full-qa/screenshots/)
// PHP page references journeys/<name> — copy logic uses basename; same source is fine.

$results = null;
$journeys = null;

if (file_exists($RESULTS_FILE)) {
    $results = json_decode(file_get_contents($RESULTS_FILE), true);
}
if (file_exists($JOURNEYS_FILE)) {
    $journeys = json_decode(file_get_contents($JOURNEYS_FILE), true);
}

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function badge(string $kind): string {
    $map = [
        'pass' => '<span class="badge pass">✓ PASS</span>',
        'fail' => '<span class="badge fail">✗ FAIL</span>',
        'warn' => '<span class="badge warn">⚠ WARN</span>',
        'err'  => '<span class="badge err">✗ ERR</span>',
    ];
    return $map[$kind] ?? '<span class="badge">?</span>';
}

$total = 0; $passed = 0; $failed = 0; $issues = 0;
$ce = 0; $ne = 0;
if ($results) {
    foreach ($results['roles'] as $s) {
        $total += $s['totalFeatures'];
        $passed += $s['passed'];
        $failed += $s['failed'];
        $issues += $s['totalIssues'];
        $ce += count($s['consoleErrors'] ?? []);
        $ne += count($s['networkErrors'] ?? []);
    }
}
$journeyCount = $journeys ? count($journeys['journeys'] ?? []) : 0;
$journeyPassed = 0;
if ($journeys) foreach ($journeys['journeys'] ?? [] as $j) if ($j['passed']) $journeyPassed++;

$passPct = $total ? round(($passed / $total) * 100, 1) : 0;
?>
<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pos-uat.akhairi.com — Full QA Evidence</title>
<style>
  :root {
    --bg: #0a0a0a; --fg: #e5e5e5; --muted: #888; --line: #1a1a1a; --line2: #222;
    --acc: #fb923c; --pass: #22c55e; --fail: #ef4444; --warn: #eab308; --err: #ef4444;
    --code: #0d0d0d;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: var(--bg); color: var(--fg); margin: 0; padding: 20px; font-size: 13px; line-height: 1.5; }
  h1, h2, h3 { color: var(--acc); font-weight: 600; margin: 0 0 12px 0; }
  h1 { font-size: 22px; border-bottom: 1px solid var(--line2); padding-bottom: 12px; margin-bottom: 24px; }
  h2 { font-size: 17px; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--line); }
  h3 { font-size: 14px; color: var(--fg); margin-top: 18px; }
  a { color: var(--acc); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: 'SF Mono', Menlo, Consolas, monospace; background: var(--code); color: #c4c4c4; padding: 1px 6px; border-radius: 3px; font-size: 12px; }
  pre { padding: 10px 12px; overflow-x: auto; line-height: 1.4; }
  pre .err { color: #ef4444; }
  pre .warn { color: #eab308; }
  pre .pass { color: #22c55e; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { background: #0d0d0d; color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  tr:hover td { background: #0d0d0d; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-bottom: 20px; }
  .summary > div { background: #0d0d0d; border: 1px solid var(--line2); border-radius: 6px; padding: 12px 14px; }
  .summary .num { font-size: 22px; font-weight: 700; color: var(--acc); }
  .summary .lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.3px; }
  .badge.pass { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
  .badge.fail { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
  .badge.warn { background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); }
  .badge.err  { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
  .role { font-size: 11px; padding: 1px 5px; background: #1a1a1a; color: var(--muted); border-radius: 3px; margin-left: 4px; }
  details { margin: 6px 0; }
  details summary { cursor: pointer; padding: 6px 10px; background: #0d0d0d; border: 1px solid var(--line2); border-radius: 4px; font-size: 12px; }
  details summary:hover { background: #111; }
  .issue { padding: 8px 10px; margin: 4px 0; border-left: 3px solid var(--fail); background: rgba(239, 68, 68, 0.05); font-size: 11px; }
  .issue.warn { border-left-color: var(--warn); background: rgba(234, 179, 8, 0.05); }
  .issue .ctx { color: var(--muted); font-size: 10px; margin-top: 4px; }
  .screenshot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin: 10px 0; }
  .screenshot { background: #0d0d0d; border: 1px solid var(--line2); border-radius: 4px; padding: 6px; }
  .screenshot img { width: 100%; height: auto; border-radius: 2px; cursor: pointer; }
  .screenshot .cap { font-size: 10px; color: var(--muted); margin-top: 4px; }
  .journey { background: #0d0d0d; border: 1px solid var(--line2); border-radius: 6px; padding: 14px; margin: 12px 0; }
  .journey-header { display: flex; justify-content: space-between; align-items: center; }
  .meta { font-size: 11px; color: var(--muted); }
  .empty { padding: 40px; text-align: center; color: var(--muted); border: 1px dashed var(--line2); border-radius: 6px; }
  .refresh { position: fixed; top: 20px; right: 20px; background: #0d0d0d; padding: 6px 10px; border: 1px solid var(--line2); border-radius: 4px; font-size: 11px; }
  .progress { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; margin-top: 4px; }
  .progress > div { height: 100%; background: var(--pass); }
  .progress > div.fail { background: var(--fail); }
  .timestamp { color: var(--muted); font-size: 11px; }
</style>
</head>
<body>
<div class="refresh">Auto-refresh 30s</div>
<h1>pos-uat.akhairi.com — Full QA Evidence</h1>
<p class="meta">Generated <?= date('Y-m-d H:i:s T') ?> · Tests run: <?= h($results['timestamp'] ?? 'never') ?> · Base: <code><?= h($results['base'] ?? 'unknown') ?></code></p>

<?php if (!$results): ?>
<div class="empty">
  <h2>⏳ No test results yet</h2>
  <p>Run <code>npx playwright test --config=playwright.full-qa.config.ts</code> from the repo root.</p>
  <p>This page auto-refreshes every 30 seconds.</p>
</div>
<?php else: ?>

<!-- ============ OVERALL SUMMARY ============ -->
<h2>Ringkasan</h2>
<div class="summary">
  <div><div class="num"><?= $total ?></div><div class="lbl">Total feature visits</div></div>
  <div><div class="num" style="color:var(--pass)"><?= $passed ?></div><div class="lbl">Passed (<?= $passPct ?>%)</div></div>
  <div><div class="num" style="color:var(--fail)"><?= $failed ?></div><div class="lbl">Failed</div></div>
  <div><div class="num" style="color:var(--warn)"><?= $issues ?></div><div class="lbl">Issues</div></div>
  <div><div class="num" style="color:var(--err)"><?= $ce ?></div><div class="lbl">Console errors</div></div>
  <div><div class="num" style="color:var(--err)"><?= $ne ?></div><div class="lbl">Network errors</div></div>
  <div><div class="num"><?= $journeyCount ?></div><div class="lbl">User journeys</div></div>
  <div><div class="num" style="color:var(--pass)"><?= $journeyPassed ?></div><div class="lbl">Journeys passed</div></div>
</div>

<?php if ($failed === 0 && $issues === 0): ?>
<p><span class="badge pass">✓ ALL FEATURES PASS</span> &nbsp; <span class="badge pass">✓ NO ISSUES</span> &nbsp; Production ready.</p>
<?php else: ?>
<p><span class="badge fail"><?= $failed ?> failures</span> · <?= $issues ?> issues · See details below.</p>
<?php endif; ?>

<!-- ============ PER-ROLE ============ -->
<h2>Per-Role</h2>
<?php foreach ($results['roles'] as $role => $s): ?>
<h3><?= h(ucfirst($role)) ?> <span class="role"><?= $s['passed'] ?>/<?= $s['totalFeatures'] ?> passed</span></h3>
<?php
  $pct = $s['totalFeatures'] ? round(($s['passed'] / $s['totalFeatures']) * 100) : 0;
  $cls = $s['failed'] > 0 ? 'fail' : '';
?>
<div class="progress"><div class="<?= $cls ?>" style="width: <?= $pct ?>%"></div></div>
<table>
  <thead>
    <tr><th>Feature</th><th>Page</th><th>Expected</th><th>Observed</th><th>Status</th><th>Issues</th><th>Shot</th></tr>
  </thead>
  <tbody>
  <?php foreach ($s['results'] as $r): ?>
    <tr>
      <td><b><?= h($r['feature']) ?></b><br><span class="meta"><?= h($r['category']) ?></span></td>
      <td><code><?= h($r['page'] ?? '—') ?></code></td>
      <td><?= h($r['expected']) ?></td>
      <td><?= h($r['observed']) ?></td>
      <td><?= badge($r['passed'] ? 'pass' : 'fail') ?></td>
      <td>
        <?php if (!empty($r['issues'])): ?>
          <details>
            <summary><?= count($r['issues']) ?> issue<?= count($r['issues']) > 1 ? 's' : '' ?></summary>
            <?php foreach ($r['issues'] as $i): ?>
              <div class="issue <?= h($i['severity'] === 'warning' ? 'warn' : '') ?>">
                <b>[<?= h($i['type']) ?>/<?= h($i['severity']) ?>]</b> <?= h($i['message']) ?>
              </div>
            <?php endforeach; ?>
          </details>
        <?php else: ?>
          <span class="meta">—</span>
        <?php endif; ?>
      </td>
      <td>
        <?php if (!empty($r['screenshot'])): ?>
          <a href="screenshots/<?= h(basename($r['screenshot'])) ?>" target="_blank">📷</a>
        <?php else: ?>
          <span class="meta">—</span>
        <?php endif; ?>
      </td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endforeach; ?>

<!-- ============ CONSOLE / NETWORK LOGS ============ -->
<h2>Console + Network Errors</h2>
<?php foreach ($results['roles'] as $role => $s): ?>
<?php if (empty($s['consoleErrors']) && empty($s['networkErrors'])) continue; ?>
<h3><?= h(ucfirst($role)) ?> — <?= count($s['consoleErrors']) ?> console / <?= count($s['networkErrors']) ?> network</h3>
<details>
  <summary>View all errors</summary>
  <h4 style="color:var(--muted); margin: 10px 0 4px 0; font-size:12px;">Console errors</h4>
  <?php if (empty($s['consoleErrors'])): ?>
    <p class="meta">— none —</p>
  <?php else: ?>
    <pre><?php foreach (array_slice($s['consoleErrors'], 0, 50) as $e) echo h($e) . "\n"; if (count($s['consoleErrors']) > 50) echo "... +" . (count($s['consoleErrors']) - 50) . " more\n"; ?></pre>
  <?php endif; ?>

  <h4 style="color:var(--muted); margin: 10px 0 4px 0; font-size:12px;">Network errors (4xx/5xx, failed requests)</h4>
  <?php if (empty($s['networkErrors'])): ?>
    <p class="meta">— none —</p>
  <?php else: ?>
    <pre><?php foreach (array_slice($s['networkErrors'], 0, 80) as $e) echo h($e) . "\n"; if (count($s['networkErrors']) > 80) echo "... +" . (count($s['networkErrors']) - 80) . " more\n"; ?></pre>
  <?php endif; ?>
</details>
<?php endforeach; ?>

<!-- ============ USER JOURNEYS ============ -->
<?php if ($journeys && !empty($journeys['journeys'])): ?>
<h2>User Journey — Tutorial Lengkap</h2>
<p class="meta">Real workflow per role (login → action → verify), bukan cuma page visit.</p>
<?php foreach ($journeys['journeys'] as $j): ?>
<div class="journey">
  <div class="journey-header">
    <h3 style="margin:0"><?= h($j['journey']) ?> <span class="role"><?= h($j['role']) ?></span></h3>
    <?= badge($j['passed'] ? 'pass' : 'fail') ?>
  </div>
  <p class="meta">Duration: <?= round($j['durationMs'] / 1000, 1) ?>s · <?= count($j['steps']) ?> steps · Console: <?= count($j['consoleErrors']) ?> · Network: <?= count($j['networkErrors']) ?></p>

  <table>
    <thead>
      <tr><th style="width: 25%">Step</th><th style="width: 30%">Expected</th><th style="width: 30%">Observed</th><th style="width: 10%">Status</th><th style="width: 5%">Shot</th></tr>
    </thead>
    <tbody>
    <?php foreach ($j['steps'] as $s): ?>
      <tr>
        <td><b><?= h($s['step']) ?></b><?php if ($s['notes']): ?><br><span class="meta"><?= h($s['notes']) ?></span><?php endif; ?></td>
        <td><?= h($s['expected']) ?></td>
        <td><?= h($s['observed']) ?></td>
        <td><?= badge($s['passed'] ? 'pass' : 'fail') ?></td>
        <td>
          <?php if (!empty($s['screenshot'])): ?>
            <a href="journeys/<?= h(basename($s['screenshot'])) ?>" target="_blank">📷</a>
          <?php else: ?>
            <span class="meta">—</span>
          <?php endif; ?>
        </td>
      </tr>
    <?php endforeach; ?>
    </tbody>
  </table>

  <div class="screenshot-grid">
    <?php foreach ($j['steps'] as $s): if (!empty($s['screenshot'])): ?>
      <div class="screenshot">
        <a href="journeys/<?= h(basename($s['screenshot'])) ?>" target="_blank"><img src="journeys/<?= h(basename($s['screenshot'])) ?>" alt="<?= h($s['step']) ?>"></a>
        <div class="cap"><?= h($s['step']) ?></div>
      </div>
    <?php endif; endforeach; ?>
  </div>

  <?php if (!empty($j['consoleErrors'])): ?>
    <details>
      <summary>Console errors during this journey (<?= count($j['consoleErrors']) ?>)</summary>
      <pre><?php foreach (array_slice($j['consoleErrors'], 0, 30) as $e) echo h($e) . "\n"; ?></pre>
    </details>
  <?php endif; ?>
  <?php if (!empty($j['networkErrors'])): ?>
    <details>
      <summary>Network errors during this journey (<?= count($j['networkErrors']) ?>)</summary>
      <pre><?php foreach (array_slice($j['networkErrors'], 0, 30) as $e) echo h($e) . "\n"; ?></pre>
    </details>
  <?php endif; ?>
</div>
<?php endforeach; ?>
<?php endif; ?>

<!-- ============ FOOTER ============ -->
<h2>Test Configuration</h2>
<table>
  <tr><th>Base URL</th><td><code><?= h($results['base'] ?? '—') ?></code></td></tr>
  <tr><th>Browser</th><td>Playwright Chromium (headless)</td></tr>
  <tr><th>Roles tested</th><td>owner, manager, cashier, cashier2</td></tr>
  <tr><th>Test runner</th><td><code>playwright.full-qa.config.ts</code></td></tr>
  <tr><th>Data files</th><td><code>data/full-qa-results.json</code> + <code>data/user-journeys.json</code></td></tr>
  <tr><th>Spec files</th><td><code>e2e/full-qa/full-qa.spec.ts</code> + <code>e2e/full-qa/user-journey.spec.ts</code></td></tr>
</table>

<?php endif; ?>

<script>
  // Auto-refresh every 30s
  setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>
