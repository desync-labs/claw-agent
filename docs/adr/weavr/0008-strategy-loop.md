# ADR-0008 — The autonomous loop: a strategy file, a schedule, a proposal with a button

**Status:** proposed · **Date:** 14 Sep 2026

## Context

weavr's brief for its own agent: "create and curate portfolios following a
set of rules (a strategy)", shown in the app as a feature and a proof of
concept; users may run the same from this repository. Today the agent acts
when a person asks — analysis, proposal, one yes, one button — and the
keeper handles drift inside the 2% band on its own. What is missing is the
agent **initiating**: reviewing its portfolios on a schedule and proposing a
change when the rules say so.

Hermes has a cron facility that runs a prompt on a schedule and delivers
the result to a *home channel* (`/sethome` in Telegram). Approval bubbles
work on that channel like on any other.

## Decision (proposed)

- A **strategy file** per curated portfolio, versioned in this repository
  and read by the agent through the skill: the asset universe (weavr
  tickers), constraints (max share per asset, min number of assets, assets
  excluded), the rebalance rule (drift beyond X, a trend/momentum rule over
  `get_asset_history`, a floor on expected improvement from
  `simulate_rebalance`), the review cadence, and the approval mode.
- A **scheduled review**: Hermes cron, e.g. daily, prompt "review <ticker>
  against its strategy; if a change is due, simulate it and propose it".
  The review is reads only; a proposal is `--propose`, which the gate
  escalates to the home channel — the same button as a human-initiated
  change.
- **Approval mode** in the strategy: `button` (default, users' agents) or
  `auto` for weavr's own agent, bounded by the file's limits (max change per
  review, max frequency, allowed universe); `auto` is a plugin allowlist
  entry that the gate consults, never a Hermes-wide setting.
- The **app** marks agent-curated portfolios (curator = an agent wallet,
  strategy linked through `build_set_portfolio_metadata`) and shows the
  agent's proposals as a feed.

## Open questions

- The strategy rules themselves (weavr's product decision; an example file is
  needed before the loop is built).
- Whether `auto` mode is acceptable for the grant showcase or the team wants
  the button in a shared channel.
- Cron toolset: enable for the schedule only, not as a tool the model calls
  (ADR-0003).
