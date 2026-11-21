# Monitoring: logi w Log Analytics

Wszystkie logi CloudDesk trafiają do jednego workspace'u **`log-clouddesk`** (grupa `rg-clouddesk`). Nie trzeba logować się na żadną maszynę.

| Źródło | Jak trafia do Log Analytics | Tabela |
|---|---|---|
| Backend FastAPI (`ca-clouddesk-backend`): stdout/stderr, w tym access log uvicorna | środowisko Container Apps (`terraform/app.tf`) | `ContainerAppConsoleLogs_CL` |
| Zadania migracji i kopii bazy (`caj-clouddesk-migrate`, `caj-clouddesk-backup`) | środowisko Container Apps | `ContainerAppConsoleLogs_CL` (kolumna `ContainerJobName_s`) |
| Zdarzenia platformy Container Apps (start rewizji, restarty, sondy) | środowisko Container Apps | `ContainerAppSystemLogs_CL` |
| PostgreSQL: błędy, połączenia, wolne zapytania (> 500 ms) | diagnostic setting `diag-psql-clouddesk-…` (`terraform/monitoring.tf`) | `AzureDiagnostics` (`Category == "PostgreSQLLogs"`) |
| PostgreSQL: metryki (CPU, pamięć, połączenia, dysk) | ten sam diagnostic setting | `AzureMetrics` |

**Jak uruchomić zapytanie:** portal Azure → `log-clouddesk` → **Logs** → wklej zapytanie → **Run**. Z terminala:
```bash
W=$(az monitor log-analytics workspace show -g rg-clouddesk -n log-clouddesk --query customerId -o tsv)
az monitor log-analytics query -w "$W" --analytics-query "<zapytanie>" -o table
```

**Co nie trafia do logów:** hasła i `DATABASE_URL` (backend ich nie wypisuje, a hasło bazy jest tylko w Key Vault). Wolne zapytania logujemy z samym SQL-em; wartości parametrów (`$1`, `$2`…) są wyłączone (`log_parameter_max_length = 0`), więc treść zgłoszeń tam nie trafia.

**Wyjątek:** przy naruszeniu ograniczenia Postgres dopisuje do błędu linię `DETAIL` z wartością, np. `Key (email)=(…) already exists` przy zajętym e-mailu. Takie wpisy widzi tylko zespół (te same role co do bazy), a workspace trzyma je 30 dni.

## Zapytania

### 1. Logi backendu z ostatniej godziny
```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(1h)
| where ContainerAppName_s == "ca-clouddesk-backend"
| project TimeGenerated, RevisionName_s, Stream_s, Log_s
| order by TimeGenerated desc
```

### 2. Żądania HTTP: kody odpowiedzi w czasie
Access log uvicorna ma postać `INFO:     100.100.0.20:54980 - "GET /api/tickets HTTP/1.1" 200 OK`.
```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where ContainerAppName_s == "ca-clouddesk-backend"
| parse Log_s with * '- "' Method ' ' Path ' HTTP/' * '" ' Status:int ' ' *
| where isnotnull(Status)
| extend Class = strcat(tostring(Status / 100), "xx")
| summarize Requests = count() by bin(TimeGenerated, 15m), Class
| render columnchart
```

### 3. Błędy 5xx i tracebacki backendu
```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(7d)
| where ContainerAppName_s == "ca-clouddesk-backend"
| parse Log_s with * '- "' Method ' ' Path ' HTTP/' * '" ' Status:int ' ' *
| where Status >= 500 or Log_s has_any ("Traceback", "ERROR", "Exception")
| project TimeGenerated, RevisionName_s, Method, Path, Status, Log_s
| order by TimeGenerated desc
```

### 4. Zmiany zgłoszeń (POST / PATCH / DELETE na `/api/tickets`)
```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(7d)
| where ContainerAppName_s == "ca-clouddesk-backend"
| parse Log_s with * '- "' Method ' ' Path ' HTTP/' * '" ' Status:int ' ' *
| where Path startswith "/api/tickets" and Method in ("POST", "PATCH", "PUT", "DELETE")
| project TimeGenerated, Method, Path, Status
| order by TimeGenerated desc
```

### 5. Migracje i kopie zapasowe bazy
```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(7d)
| where ContainerJobName_s in ("caj-clouddesk-migrate", "caj-clouddesk-backup")
| project TimeGenerated, ContainerJobName_s, Stream_s, Log_s
| order by TimeGenerated desc
```

### 6. Logi PostgreSQL: błędy i ostrzeżenia
```kusto
AzureDiagnostics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.DBFORPOSTGRESQL" and Category == "PostgreSQLLogs"
| where errorLevel_s in ("WARNING", "ERROR", "FATAL", "PANIC")
| project TimeGenerated, errorLevel_s, sqlerrcode_s, Message
| order by TimeGenerated desc
```

### 7. PostgreSQL: połączenia i wolne zapytania
```kusto
AzureDiagnostics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.DBFORPOSTGRESQL" and Category == "PostgreSQLLogs"
| where Message has_any ("connection authorized", "disconnection", "duration:")
| extend Kind = case(Message has "duration:", "wolne zapytanie",
                     Message has "disconnection", "rozłączenie", "połączenie")
| project TimeGenerated, Kind, Message
| order by TimeGenerated desc
```

### 8. PostgreSQL: CPU, pamięć i połączenia
```kusto
AzureMetrics
| where TimeGenerated > ago(24h)
| where ResourceProvider == "MICROSOFT.DBFORPOSTGRESQL"
| where MetricName in ("cpu_percent", "memory_percent", "active_connections")
| summarize Value = avg(Average) by bin(TimeGenerated, 15m), MetricName
| render timechart
```

### 9. Backend i baza na jednej osi czasu
Pomaga przy diagnozie: co działo się w bazie, gdy backend zwrócił błąd.
```kusto
union
  (ContainerAppConsoleLogs_CL
   | where ContainerAppName_s == "ca-clouddesk-backend"
   | project TimeGenerated, Source = "backend", Text = Log_s),
  (AzureDiagnostics
   | where ResourceProvider == "MICROSOFT.DBFORPOSTGRESQL" and Category == "PostgreSQLLogs"
   | project TimeGenerated, Source = "postgres", Text = Message)
| where TimeGenerated > ago(1h)
| order by TimeGenerated desc
```

### 10. Koszt logów: ile MB dziennie
Workspace ma darmowe 5 GB/mies. i dzienny limit 0,15 GB (`daily_quota_gb` w `terraform/app.tf`).
```kusto
Usage
| where TimeGenerated > ago(30d) and IsBillable
| summarize MB = round(sum(Quantity), 2) by bin(TimeGenerated, 1d), DataType
| render columnchart
```
