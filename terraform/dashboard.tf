# Monitoring (Blok 10): dashboard w portalu Azure z metrykami platformy – backendu (Container App), vm-web i bazy.
# Metryki zbiera Azure Monitor bez agentów i bez dodatkowych kosztów; dashboard tylko je wyświetla.
# Kafelki opisuje lista local.dashboard_charts, a JSON dashboardu składa jsonencode (bez ręcznego JSON-a).

locals {
  backend     = azurerm_container_app.backend
  backend_cpu = local.backend.template[0].container[0].cpu
  backend_ram = local.backend.template[0].container[0].memory
  web_vm      = azurerm_linux_virtual_machine.web
  db          = azurerm_postgresql_flexible_server.main

  ns_backend = "microsoft.app/containerapps"
  ns_vm      = "microsoft.compute/virtualmachines"
  ns_db      = "microsoft.dbforpostgresql/flexibleservers"

  # Kody agregacji w portalu Azure i ich nazwy w legendzie.
  agg       = { sum = 1, max = 3, avg = 4 }
  agg_label = { sum = "suma", max = "maksimum", avg = "średnio" }
  # Polskie nazwy serii w legendzie (nazwy metryk Azure są po angielsku).
  metric_label = {
    "Requests"                    = "Żądania"
    "ResponseTime"                = "Czas odpowiedzi"
    "CpuPercentage"               = "CPU"
    "MemoryPercentage"            = "RAM"
    "Percentage CPU"              = "CPU"
    "Available Memory Percentage" = "Wolny RAM"
    "cpu_percent"                 = "CPU"
    "memory_percent"              = "RAM"
    "active_connections"          = "Połączenia"
    "storage_percent"             = "Zajęty dysk"
    "Replicas"                    = "Repliki"
    "RestartCount"                = "Restarty"
  }

  # Każdy kafelek: jedna metryka jednego zasobu, po jednej serii na statystykę z listy stats.
  # Siatka: 2 kafelki 6×4 w rzędzie; nagłówek zajmuje rzędy 0–1.
  dashboard_charts = [
    {
      title = "Żądania backendu wg kodu odpowiedzi (2xx / 4xx / 5xx)"
      id    = local.backend.id, ns = local.ns_backend, metric = "Requests", stats = ["sum"]
      # Podział jednej metryki na serie po wymiarze.
      group_by = "statusCodeCategory"
    },
    {
      title    = "Czas odpowiedzi API (ms)"
      id       = local.backend.id, ns = local.ns_backend, metric = "ResponseTime", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "Backend – CPU (% przydziału ${local.backend_cpu} vCPU)"
      id       = local.backend.id, ns = local.ns_backend, metric = "CpuPercentage", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "Backend – pamięć RAM (% przydziału ${local.backend_ram})"
      id       = local.backend.id, ns = local.ns_backend, metric = "MemoryPercentage", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "${local.web_vm.name} (Nginx) – CPU (%)"
      id       = local.web_vm.id, ns = local.ns_vm, metric = "Percentage CPU", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "${local.web_vm.name} (Nginx) – wolna pamięć RAM (%)"
      id       = local.web_vm.id, ns = local.ns_vm, metric = "Available Memory Percentage", stats = ["avg"]
      group_by = null
    },
    {
      title    = "Baza ${local.db.name} – CPU (%)"
      id       = local.db.id, ns = local.ns_db, metric = "cpu_percent", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "Baza – pamięć RAM (%)"
      id       = local.db.id, ns = local.ns_db, metric = "memory_percent", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "Baza – aktywne połączenia"
      id       = local.db.id, ns = local.ns_db, metric = "active_connections", stats = ["avg", "max"]
      group_by = null
    },
    {
      title    = "Baza – zajęte miejsce na dysku (%)"
      id       = local.db.id, ns = local.ns_db, metric = "storage_percent", stats = ["max"]
      group_by = null
    },
    {
      title    = "Backend – liczba replik"
      id       = local.backend.id, ns = local.ns_backend, metric = "Replicas", stats = ["max"]
      group_by = null
    },
    {
      title    = "Backend – restarty kontenera"
      id       = local.backend.id, ns = local.ns_backend, metric = "RestartCount", stats = ["max"]
      group_by = null
    },
  ]

  dashboard_header = <<-EOT
    ## CloudDesk – monitoring produkcji
    Metryki platformy Azure Monitor: backend `${local.backend.name}` (Container Apps), `${local.web_vm.name}` (Nginx) i baza `${local.db.name}`. Domyślny zakres: ostatnie 24 h. Puste wykresy backendu = brak ruchu (backend skaluje się do zera).
    Stan aplikacji i połączenia z bazą: `GET /api/health` (opis w tabeli API w README). Logi: Log Analytics `${azurerm_log_analytics_workspace.main.name}`.
  EOT

  dashboard_parts = merge(
    {
      "0" = {
        position = { x = 0, y = 0, colSpan = 12, rowSpan = 2 }
        metadata = {
          inputs = []
          type   = "Extension/HubsExtension/PartType/MarkdownPart"
          settings = {
            content = {
              settings = { content = local.dashboard_header, title = "", subtitle = "", markdownSource = 1 }
            }
          }
        }
      }
    },
    {
      for i, c in local.dashboard_charts : tostring(i + 1) => {
        position = { x = (i % 2) * 6, y = 2 + floor(i / 2) * 4, colSpan = 6, rowSpan = 4 }
        metadata = {
          inputs = [
            { name = "options", isOptional = true },
            { name = "sharedTimeRange", isOptional = true },
          ]
          type = "Extension/HubsExtension/PartType/MonitorChartPart"
          settings = {
            content = {
              options = {
                chart = merge(
                  {
                    title     = c.title
                    titleKind = 2 # własny tytuł zamiast nazwy metryki
                    metrics = [
                      for st in c.stats : {
                        resourceMetadata    = { id = c.id }
                        name                = c.metric
                        namespace           = c.ns
                        aggregationType     = local.agg[st]
                        metricVisualization = { displayName = "${local.metric_label[c.metric]} (${local.agg_label[st]})" }
                      }
                    ]
                    visualization = {
                      chartType           = 2 # wykres liniowy
                      legendVisualization = { isVisible = true, position = 2, hideSubtitle = false }
                      axisVisualization = {
                        x = { isVisible = true, axisType = 2 }
                        y = { isVisible = true, axisType = 1 }
                      }
                      disablePinning = true
                    }
                  },
                  { for k, v in { grouping = { dimension = c.group_by, sort = 2, top = 10 } } : k => v if c.group_by != null }
                )
              }
            }
          }
        }
      }
    }
  )
}

resource "azurerm_portal_dashboard" "monitoring" {
  name                = "dash-${var.prefix}-monitoring"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  # Tag hidden-title to nazwa wyświetlana w portalu (nazwa zasobu nie może mieć spacji).
  tags = merge(local.tags, { "hidden-title" = "CloudDesk – monitoring" })

  dashboard_properties = jsonencode({
    lenses = {
      "0" = { order = 0, parts = local.dashboard_parts }
    }
    metadata = {
      model = {
        timeRange = {
          type  = "MsPortalFx.Composition.Configuration.ValueTypes.TimeRange"
          value = { relative = { duration = 24, timeUnit = 1 } }
        }
        filterLocale = { value = "pl-pl" }
        filters = {
          value = {
            MsPortalFx_TimeRange = {
              model        = { format = "local", granularity = "auto", relative = "24h" }
              displayCache = { name = "Czas lokalny", value = "Ostatnie 24 godziny" }
            }
          }
        }
      }
    }
  })
}
