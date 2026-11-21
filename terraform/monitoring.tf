# Monitoring: logi i metryki bazy w tym samym Log Analytics co logi backendu (log-clouddesk),
# żeby jednym zapytaniem KQL zobaczyć, co działo się w aplikacji i w bazie. Zapytania: docs/monitoring/.

# Logi serwera PostgreSQL (błędy, połączenia, wolne zapytania) i metryki (CPU, pamięć, połączenia, dysk).
# Trafiają do tabel AzureDiagnostics i AzureMetrics. Limit dzienny workspace'u (app.tf) obejmuje też te dane.
resource "azurerm_monitor_diagnostic_setting" "postgres" {
  name                       = "diag-${azurerm_postgresql_flexible_server.main.name}"
  target_resource_id         = azurerm_postgresql_flexible_server.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "PostgreSQLLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

# Zapytania wolniejsze niż 500 ms trafiają do logów z czasem wykonania i treścią SQL. Aplikacja wysyła
# zapytania z parametrami ($1, $2…), więc sam SQL nie zawiera danych ze zgłoszeń.
resource "azurerm_postgresql_flexible_server_configuration" "log_min_duration_statement" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "500"
}

# Wartości parametrów (np. opis zgłoszenia, e-mail) nie trafiają do logów: domyślnie (-1) Postgres dopisuje je
# w całości do wpisu o wolnym zapytaniu. 0 wyłącza ich logowanie.
resource "azurerm_postgresql_flexible_server_configuration" "log_parameter_max_length" {
  name      = "log_parameter_max_length"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "0"
}
