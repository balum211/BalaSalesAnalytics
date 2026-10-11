# Vibe-Coding Log: Prompts, Iterations and Learnings

This log records how ChainSight was built with Claude as the AI coding partner. Each step lists the prompt, what the AI produced, and what I checked or changed.

---

## Iteration 0: Framing the project
**Prompt (to Claude):**
> I want to go with Path 3 Option C: Sales Analytics Dashboard with Supply Chain Logistics domain with Tech Stack Node js, Claude Code, Power BI dashboard + web portal with rich themes. My GitHub `balum211/BalaSalesAnalytics` should store all code to submit and the Power BI / web portal link.

**Result:** Claude read the Week 1 handout and confirmed the 3 deliverables (doc, video of 5 minutes or less, GitHub repo). It proposed this architecture: one dataset → a shared KPI engine → (a) a Node web portal and (b) a Power BI star schema.

## Iteration 1: Dataset
**Prompt:**
> Generate a realistic, reproducible supply-chain sales dataset (≈6,000 orders, 2024–2025): regions, countries, warehouses, customer segments, product categories, ship modes, carriers, quantity, price, discount, revenue, COGS, freight cost, gross profit, promised vs actual delivery days, on-time flag, order status. Build in patterns an analyst could discover.

**Result:** `scripts/generate-data.js` with a seeded random generator. Built-in patterns: Q4 seasonality, 18% YoY growth, carrier reliability profiles, Q4 congestion, Pharma shipping by air more often, and returns and cancellations.
**Iteration:** The order IDs were not in date order after sorting. A follow-up prompt fixed this by renumbering the IDs after the sort.
**Check:** Totals were sanity-checked: $32.0M revenue, 18.2% margin, 88.6% OTD.

## Iteration 2: Server and API
**Prompt:**
> Build a Node.js server that serves the portal and exposes /api/health, /api/meta, /api/kpis, /api/breakdown/:dimension, /api/orders (paged), /api/insights. Put all KPI math in one module shared by browser and server so numbers always match.

**Result:** `public/js/analytics.js` is a UMD module used by both the browser and Node. `server.js` was first written with Express.
**🐞 Bug / pivot:** `npm install` couldn't reach the package registry in the build sandbox. **Prompt:** *"Rewrite the server with only Node's built-in http module: no dependencies."* The result is a zero-dependency server that also protects against path traversal. The upside is that `npm start` works with no install step.

## Iteration 3: Web portal UI and themes
**Prompt:**
> Create a polished dashboard: sidebar navigation, sticky global filter bar (date range, region, category, segment, ship mode, carrier, quick 2024/2025/All), KPI tiles with period-over-period deltas, Chart.js charts, warehouse and customer tables, orders explorer with search/sort/pagination/CSV export, AI insights cards, Power BI embed tab. Five rich themes (2 dark, 3 light incl. a Power BI-like "Corporate"). Use a colorblind-safe palette and keep each entity's color stable across filters. Show a clear message when filters return nothing. Must work on mobile.

**Result:** `index.html`, `css/styles.css` (themes built on CSS custom properties) and `js/app.js`.
**🐞 Bug / pivot:** The Chart.js CDN was blocked in the sandbox, so the charts didn't render. **Fix:** Chart.js 4.4.1 is now vendored into `public/vendor/`. The portal now works offline and on GitHub Pages without a CDN.

## Iteration 4: Visual QA with screenshots
**Prompt:**
> Take Playwright screenshots of every view in different themes plus mobile and the empty state, then review them and fix what looks wrong.

Fixes made from the screenshot review:
| Issue seen | Fix |
|---|---|
| Navigating by URL hash (`#overview`) didn't switch views, and the filters stayed hidden after the Power BI tab | Added a `hashchange` listener |
| KPI tiles said "no prior period" on the default All range | Default period set to **2025**, so the tiles show change vs 2024 |
| Carrier axis skipped every other label | Turned off tick auto-skip on that chart |
| Orders table overflowed at 1440px | Removed the redundant Warehouse column and tightened cell padding |
| Peak-month insight printed "2025-12" | Formatted it as "December 2025" |
| Top-10 product bars used category colors with no legend | Switched to one color; the axis labels already identify each product |
| Rows with the same date sorted unpredictably | Added order ID as a tie-breaker |

Mobile check: no horizontal scroll at 390px.

## Iteration 5: AI insights
**Prompt:**
> Add an insights engine: rule-based by default (top region share, YoY growth, worst vs best carrier OTD, Q4 congestion, most expensive ship mode, margin mix, peak month, returns). If ANTHROPIC_API_KEY is set, send only aggregated metrics to Claude and ask for 6 VP-level insights as strict JSON, falling back to rules on any error.

**Result:** `POST /api/insights`. The privacy rule is that raw order rows never leave the server, only grouped KPIs.

## Iteration 6: Power BI
**Prompt:**
> Turn the flat CSV into a star schema (FactSales + DimDate/Product/Customer/Geography/Carrier), write DAX measures that match the portal's KPI definitions (incl. YoY, YTD, rolling 3M, OTD status color), a dark Power BI theme JSON matching the portal, and a step-by-step build + publish guide.

**Result:** the `powerbi/` folder. The report is then built in Power BI Desktop by following the guide, and the Publish-to-web link goes into `public/js/config.js`.

## Iteration 7: Quality and deployment
**Prompt:**
> Add smoke tests for every endpoint (incl. regions summing to total and a path-traversal check), a GitHub Actions workflow that runs tests and deploys public/ to GitHub Pages, VS Code launch config, README.

**Result:** `npm test` passes. `.github/workflows/pages.yml` and `.vscode/launch.json` were added.

## Iteration 8: "Ask the data" chatbot
**Prompt:**
> Add a chatbot to the dashboard so a user can ask any question about the sales data.

**Result:**
- `public/js/chat-engine.js` has two parts. `runQuery(spec)` is a structured query (metrics × group_by × filters × sort × limit). `answer(question)` is a built-in analyst that parses plain-English questions (metrics, dimensions, entity names, years, quarters, months, top/bottom N, compare, growth, trend) into a query and writes the answer.
- `POST /api/chat`: when `ANTHROPIC_API_KEY` is set, **Claude gets `runQuery` as a `query_sales` tool** and loops through tool calls (up to 8) before answering. It never invents numbers. On any error the built-in analyst answers instead.
- `public/js/chat-ui.js`: a floating "Ask the data" panel with suggestion chips, mini charts, data tables, a "Show this on the dashboard" button, Ctrl+K to open, and mobile full-screen.

**🐞 Bugs found by the question test suite (`scripts/chat-test.js`):**
| Issue | Fix |
|---|---|
| "How did revenue grow from 2024 to 2025?" said it *fell*, because years were sorted by value | Time dimensions now always sort chronologically |
| "Which region grew fastest?" was read as a delivery-*speed* question | "fast/slow" maps to delivery time only when the question isn't about growth |
| "late shipments by carrier" answered with order counts | Removed "shipments" as a synonym for orders |
| Compare answers printed an empty "()" | Scope text is only added when it's non-empty |
| The chat panel wouldn't open from the `#ask` link | The deep link is captured before the router rewrites the hash |
| Chat line charts showed 0–11 instead of month names | Fixed the axis tick callback |

## Iteration 9: Modern look and interactive analysis
**Prompt:**
> I want this dashboard more modern look, not black background, with themes, rich visuals, interactive for analysis.

**Result:** a new default **Horizon** theme (light, glassy cards, soft gradients, light sidebar), with all sidebar colors moved into theme tokens. Also added KPI sparklines, a region × category heatmap, and a segment donut with a clickable legend. Clicking any bar, slice, cell or warehouse row filters the whole dashboard, with removable filter chips. Visual QA caught overlapping carrier labels (now wrapped) and empty space in KPI tiles without sparklines.

---

## Learnings
1. **One source of truth for metrics.** Sharing `analytics.js` between the browser, the API and the DAX definitions meant the web portal and Power BI agree on every number.
2. **Treat the AI's output like a junior teammate's PR.** The screenshot review caught 7 real UX bugs that the code alone didn't reveal.
3. **Environment constraints drive design.** The blocked npm registry and CDN led to a zero-dependency, offline-capable app, which is simpler to deploy.
4. **Prompt for constraints, not just features.** Asking for "colorblind-safe, stable entity colors, empty-state message, mobile" up front avoided rework.
5. **Keep AI features private by design.** Sending aggregates instead of raw rows to the LLM is both cheaper and safer.

## Prompts to replay live in Claude Code (VS Code) for the demo
1. "Explain the architecture of this repo in 5 bullets."
2. "Add a 'Country' filter to the global filter bar and make every view respect it."
3. "Add a KPI tile for Average Order Value with change vs the prior period."
4. "Run npm test and fix anything that fails."
