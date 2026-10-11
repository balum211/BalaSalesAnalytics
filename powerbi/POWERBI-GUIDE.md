# Power BI Report — Build Guide (≈30 minutes)

This folder contains everything needed to build the **ChainSight** Power BI report on the same data as the web portal.

| File | Purpose |
|---|---|
| `data/FactSales.csv` + `data/Dim*.csv` | Star-schema tables (run `npm run powerbi` to regenerate) |
| `ChainSight-theme.json` | Dark "Midnight" report theme matching the web portal |
| `DAX-measures.dax` | All measures (Revenue, Gross Margin %, On-Time Delivery %, YoY, rolling, status colors) |

> Power BI Desktop is Windows-only and free: <https://powerbi.microsoft.com/desktop>. Publishing needs a free Power BI account (work/school email).

---

## 1. Load data
1. **Home → Get data → Text/CSV** → load each file in `powerbi/data/` (FactSales, DimDate, DimProduct, DimCustomer, DimGeography, DimCarrier).
2. In Power Query make sure `order_date`, `ship_date`, `delivery_date` and `DimDate[Date]` are type **Date**; money columns **Fixed decimal**.
3. **Close & Apply**.

## 2. Model (Model view)
Create one-to-many, single-direction relationships:

| From (many) | To (one) |
|---|---|
| FactSales[order_date] | DimDate[Date] |
| FactSales[ProductKey] | DimProduct[ProductKey] |
| FactSales[CustomerKey] | DimCustomer[CustomerKey] |
| FactSales[GeographyKey] | DimGeography[GeographyKey] |
| FactSales[CarrierKey] | DimCarrier[CarrierKey] |

Then: select **DimDate → Table tools → Mark as date table** (column `Date`). Sort `DimDate[Month]` by `MonthNumber`.

## 3. Measures
**Home → Enter data** → name the table `_Measures` → Load. Paste each measure from `DAX-measures.dax` via **New measure**.
Format: `Revenue`, `Gross Profit`, `Freight Cost`, `Avg Order Value` → Currency; `%` measures → Percentage, 1 decimal.

## 4. Theme
**View → Themes → Browse for themes** → `ChainSight-theme.json`.

## 5. Report pages (mirror the web portal)

**Page 1 — Executive Overview**
- Slicers (top row): `DimDate[Year]`, `DimGeography[region]`, `DimProduct[product_category]`, `DimCustomer[customer_segment]`, `DimCarrier[ship_mode]`
- 6 Cards: Revenue, Gross Profit, Gross Margin %, Orders, On-Time Delivery %, Avg Delivery Days (add `Revenue YoY %` as reference label)
- Line chart: X = `DimDate[YearMonth]`, Y = Revenue, Gross Profit
- Bar charts: Revenue by `region`, by `product_category`, by `customer_segment`

**Page 2 — Logistics & Delivery**
- Column chart: On-Time Delivery % by `DimCarrier[carrier]` + constant line at 0.90 (Analytics pane)
- Clustered column: Avg Promised Days vs Avg Delivery Days by `ship_mode`
- Line: On-Time Delivery % by `YearMonth`
- Bar: Freight % of Revenue by `ship_mode`
- Table: `DimGeography[warehouse]` with Orders, Revenue, Gross Margin %, On-Time Delivery % (conditional formatting → Font color → Field value → `OTD Status Color`), Avg Delivery Days, Freight %

**Page 3 — Products & Customers**
- Bar: Top 10 `product_name` by Revenue (Filters pane → Top N = 10)
- Bar: Gross Margin % by `product_category`
- Table: Top customers with segment, Orders, Revenue, Avg Order Value, Gross Margin %, On-Time Delivery %
- Map / Filled map: Revenue by `DimGeography[country]` (optional)

**Page 4 — Smart Narrative / Q&A** (optional AI touch)
- Insert → **Smart narrative** and **Q&A** visual ("revenue by carrier in 2025").

## 6. Publish & get the link
1. **File → Save** as `powerbi/ChainSight.pbix` (commit it to GitHub).
2. **Home → Publish** → My workspace.
3. In Power BI Service open the report → **File → Embed report → Publish to web (public)** → copy the link
   *(If your tenant disables Publish-to-web, use **Share** link instead, or take screenshots for the submission.)*
4. Paste the link into `public/js/config.js` → `POWERBI_EMBED_URL`. The web portal's **Power BI Report** tab will embed it.
