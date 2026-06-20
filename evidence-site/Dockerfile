FROM php:8.4-cli
# Minimal PHP built-in server
WORKDIR /app
COPY . /app
# Watch + sync data dir from e2e/full-qa/results on host
EXPOSE 8089
CMD ["php", "-S", "0.0.0.0:8089", "-t", "/app"]
