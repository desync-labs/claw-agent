# Architecture decision records — the weavr agent

Each record is one decision, the situation that forced it, and what it costs.
Dates are when the decision was proven on the rehearsal host, not when it
was written down. Status: **accepted** unless marked otherwise.

| # | Decision | Why in one line |
|---|---|---|
| [0001](0001-clawpump-derived-fork-pinned.md) | A ClawPump-derived fork, pinned, with one patch | the grant asks for a ClawPump-derived agent; a pinned commit is auditable, a floating one is not |
| [0002](0002-keys-under-their-own-user.md) | Keys under their own system user; the agent gets a seven-command proxy | a model with file tools read the PayBox config and decoded the signing key (14 Sep 2026) |
| [0003](0003-least-tools.md) | The terminal, the skill reader, clarify, and twelve weavr tools | every extra tool was a way to wander; `build_deposit` in the prompt got called with a stranger's address |
| [0004](0004-immutable-settings-and-self-modification-veto.md) | Immutable config and a veto on the agent's own settings | a model turned its approval setting off to get past a BLOCKED, then signed (14 Sep 2026) |
| [0005](0005-human-approval-in-telegram.md) | One human button per signature, in Telegram | PayBox signs anything the key is handed; the checkpoint has to be a person |
| [0006](0006-host-brief-for-local-models.md) | A host brief in the agent's cwd, in every prompt | local models did not open the skill; the brief made create and rebalance run first time |
| [0007](0007-model-choice.md) | Claude by default; a local model is possible with the brief and a 128k window | measured on three local models; only one followed the procedure, and only with the brief |
| [0008](0008-strategy-loop.md) | **proposed** — the autonomous loop: a strategy file, a schedule, a proposal with a button | "our agent creates and curates portfolios following a strategy" |

The rehearsal record behind these — what ran, what failed, the signatures —
is in the ops repository (`runbooks/CLAW_AGENT.md`).
