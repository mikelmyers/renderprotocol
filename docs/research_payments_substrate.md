# Research: Payments substrate for the carrier

Status: Scoping. Researched 2026-05-04 against public docs. Citations are inline.
Purpose: Decide which payment primitives RouteRank's carrier should sit on for
(1) bond escrow, (2) carrier take rate, (3) attestation billing, (4) premium placement.

---

## A. What Stripe actually shipped

Stripe shipped agent payments in three layered waves. The naming is messy because
three protocols are involved (ACP, MPP, x402) plus one product (Agentic Commerce
Suite) plus one new primitive (SPT). They are not synonyms.

**1. Agentic Commerce Protocol (ACP)** — an open spec co-authored with OpenAI,
launched September 2025, current beta version `2026-04-17`, Apache 2.0, on
GitHub at `agentic-commerce-protocol/agentic-commerce-protocol`. Covers four
capabilities: checkout (cart, tax, payment), OAuth 2.0 identity linking, order
tracking via webhooks, and payment-token exchange. Stewardship is currently
OpenAI + Stripe with explicit language about moving to "neutral foundation
stewardship as ecosystem matures." Reference implementations exist from both
maintainers, and the spec composes with MCP. Real production traffic: ChatGPT
Instant Checkout against Etsy (live US) and Shopify (rolling out, ~1M merchants
including Glossier, Vuori, SKIMS). [1][2][3]

**2. Agentic Commerce Suite** — Stripe's hosted product (launched 2025-12-11)
that implements ACP for merchants without forcing them to build it. Includes a
hosted ACP endpoint for catalog syndication, Stripe Checkout Sessions, Radar
fraud signals scoped to agent traffic, and SPT handling. Merchants keep
fulfillment, refunds, disputes. [4]

**3. Shared Payment Tokens (SPT)** — the actual new payment primitive. SPT is
a scoped grant of a saved payment method: the buyer's AI agent issues a token
to a specific seller's Stripe account, scoped by **amount cap, time window
(minutes, not days), and seller identity**. The merchant feeds the SPT into a
normal `PaymentIntent`. Tokens are revocable, observable via webhooks, and
single-use against the cap. SPT now also fronts BNPL (Affirm, Klarna), Mastercard
Agent Pay, and Visa Intelligent Commerce. [5][6]

**4. Machine Payments Protocol (MPP)** — co-authored by Stripe and Tempo,
launched 2026-03-18, requires API version `2026-03-04.preview`. Two settlement
paths: crypto (USDC on Tempo, sub-second finality, fees in stablecoins, no
native gas token) and fiat (cards/wallets via SPT). The flow is the HTTP-402
challenge-response: server returns 402 with payment details, client authorizes,
retries with proof, gets content + receipt. **Key differentiator from x402:
sessions.** An agent authorizes a spending cap upfront, then streams
micropayments against the session without one on-chain tx per request. [7][8][9]

**5. x402 integration** — Stripe added x402 support so merchants can accept
USDC on Base from agents using the Coinbase-originated x402 spec. This is
distinct from MPP (different chain, different protocol, no session aggregation).
Stripe positions x402 as one of several rails MPP can settle through. [9]

**Identity layer is not Stripe's.** The cryptographic verification of "is this
agent legitimate" lives in **Visa's Trusted Agent Protocol (TAP)** — note: the
strategic doc's "Trust over Algorithm Protocol" appears to be a mis-expansion.
TAP, not TOAP, is the real protocol. Three signatures: Agent Recognition
Signature (HTTP header, attests Visa-approved agent), Consumer/Device Identity
(signed body), Payment Container Signature (tamper-evident credential hash).
Stripe is one of TAP's launch partners alongside Adyen, Checkout.com, Shopify,
Worldpay, etc. So in the Stripe stack: SPT/MPP carry the **money**, TAP carries
the **agent identity attestation**. [10][11]

---

## B. Bond-and-slash mechanics

**Stripe does not ship a true escrow primitive.** This is the biggest gap for
RouteRank's bond use case. What's available:

- **Manual payouts / delayed payouts** on Connect: hold connected-account
  balance up to ~90 days. Not conditional release — just a timer. [12]
- **Place a hold** on a payment method (auth-only PaymentIntent, extended
  authorization): reserves on the buyer side, captured later. Wrong shape for
  bonds — a bond is funds we hold on the *server's* side, not an authorization
  on the buyer's card.
- **Smart-contract escrow on Tempo**: Stripe's stablecoin-treasury content
  references "smart contracts allow companies to automate ... escrow releases,
  conditional payments, fee splits." This is the Tempo path, not a managed
  Stripe API. [13]

**Recommendation for bonds.** Stripe's bond primitive doesn't exist as a turnkey
API. Three viable paths:

1. **Connect Custom + manual payouts + our own state machine.** Server posts
   $500 via PaymentIntent → funds land in a platform-controlled connected
   account → we hold via delayed payouts → on graduation, transfer back; on AR
   trip, transfer to carrier revenue account via Connect transfers. We
   implement the conditional logic; Stripe is just the rails. Dispute window
   is the standard card chargeback window (~120 days for most card types),
   which is a real risk for bond posting via card — chargebacks can claw back
   a bond *after* we've returned/forfeited it.
2. **Tempo + on-chain escrow contract.** Bond posted in USDC on Tempo, locked
   in a smart contract with the carrier as multisig releaser. Reversibility =
   none post-confirmation (good for slash semantics, eliminates chargeback
   risk). Cost = building/auditing the contract, requiring servers to hold
   USDC.
3. **Hybrid.** Accept bond via card → settle to USDC on Tempo → escrow
   on-chain. Maximum optionality, maximum complexity.

For v0 with a small server count, path 1 is pragmatic. The `bond_amount`
placeholder in `HostingAgentSpec` becomes a Connect transfer + a `bond_state`
enum (`held` / `returned` / `forfeited` / `disputed`).

---

## C. Carrier take rate

This one is clean. Stripe Connect's **destination charges** with
`application_fee_amount` is exactly the marketplace-take-rate primitive:
PaymentIntent specifies an amount, the platform's cut is `application_fee_amount`,
the connected account (hosting agent) gets the remainder, all in one charge.
Visa-style take-rate on x402/MPP/SPT-settled flows works the same way — the
PaymentIntent that consumes an SPT can carry `application_fee_amount`. [14]

**Open question.** For pure on-chain x402/MPP-on-Tempo flows that *don't* round
through a Stripe PaymentIntent, the take rate has to be enforced at the
protocol layer (e.g., the carrier's MCP-routing endpoint splits the inbound
USDC payment before forwarding). Public docs don't show a "carrier middleman"
primitive in MPP — the session is between agent and end service. This means
the carrier needs to be the *payment terminus* (with onward settlement), not a
side-channel observer, to take its rate. Architecturally this is fine, but it's
worth confirming before committing.

**Stripe's own fees** on agentic transactions: I could not find a published rate
card specific to ACP/SPT/MPP. Standard Connect pricing applies for fiat
PaymentIntents (2.9% + 30¢ baseline, plus Connect fees per connected account);
Tempo/MPP crypto fees are described as "negligible" in stablecoin terms but
unstated as a percentage. **Treat as unknown — verify with Stripe sales before
modeling unit economics.**

---

## D. Identity composition

- **Agent identity** → Visa TAP (Stripe is a launch partner, not the issuer of
  the standard). Use TAP signatures to verify "this MCP request really came
  from agent X."
- **Server identity** (signed receipts in spec 5c) → roll Ed25519 ourselves.
  Stripe doesn't ship a primitive for "this hosting agent signed this routing
  receipt." The TAP analog only attests the *requesting* agent, not the
  *serving* server. Self-managed keypairs registered in `HostingAgentSpec` is
  the right call.
- **Buyer/payment identity** → SPT covers this implicitly (the token *is* the
  scoped grant).

---

## E. Open-protocol layer

Mixed. ACP is genuinely open (Apache 2.0, GitHub, multi-implementer governance
roadmap). MPP is co-authored by Stripe + Tempo and currently coupled to Tempo
the chain — less obviously portable, though the *protocol* is published.
x402 is the most open (Apache 2.0, Coinbase + Cloudflare foundation,
chain-agnostic, ~131k daily transactions early March 2026, though ~half is
synthetic test/gamified traffic per WorkOS analysis). [9][15]

**For "any other carrier can plug in" federation:** ACP at the commerce layer
+ x402 or MPP at the settlement layer is the open path. SPT is Stripe-locked
(it's a Stripe-issued token); Agentic Commerce Suite is a Stripe product. The
**spec** is open, the **best implementation** is Stripe's. This is the same
shape as "HTTPS is open, Cloudflare is the best implementation."

For RouteRank: build the carrier to speak ACP + x402 + MPP at the protocol
layer, use Stripe's SDKs as the default fiat implementation, leave the on-chain
path open for federation. Don't bake Stripe-specific primitives into the
carrier's public interface.

---

## F. Production realities

- **Live merchants on ACP via Stripe**: URBN (Anthropologie, Free People,
  Urban Outfitters), Etsy, Ashley Furniture, Coach, Kate Spade, Nectar,
  Revolve, Halara, Abt Electronics. Etsy is live in ChatGPT Instant Checkout
  in the US; Shopify rollout in progress. [3][16]
- **Known gotchas (from Stripe's own "10 lessons" post)**: real-time inventory
  precision (millisecond expectations), product-variant ambiguity for agents,
  catalog reformatting fragmentation across AI surfaces, structured-feed data
  quality. None of these affect RouteRank directly — they're merchant-side.
- **MPP**: launched 2026-03-18, "too early for meaningful volume data" per
  third-party analysis. API is in `preview`.
- **x402**: working, but half of public traffic is testing/gamified.
- **SPT**: in production via Instant Checkout — this is the most battle-tested
  primitive in the stack.

**Stability call.** SPT + Connect destination charges are production-ready
*today* — they're just compositions of existing Stripe primitives. ACP at the
spec layer is stable enough to build against (versioned, dated, multiple
implementations). MPP is preview-quality — usable, but expect breaking changes
through 2026.

---

## Recommendation for RouteRank v0

1. **Bond escrow**: Connect Custom + delayed payouts + our own state machine.
   Plan a v1 migration to Tempo on-chain escrow if chargeback exposure becomes
   real.
2. **Carrier take rate**: Connect destination charges with `application_fee_amount`.
   For on-chain MPP/x402 paths where the carrier is the routing terminus, split
   at the protocol layer.
3. **Attestation billing ($500–5000/yr)**: ordinary Stripe Billing
   subscriptions. Nothing agent-specific needed.
4. **Premium placement**: same as 3 — Stripe Billing, with caps enforced in
   RouteRank logic, not in Stripe.
5. **Identity**: Visa TAP for agent attestation; self-managed Ed25519 for
   hosting-agent server identity.
6. **Public protocol surface**: ACP + x402 + MPP. Stripe is implementation,
   not interface.

**Gaps / things still unknown:**
- Stripe's fee schedule for SPT/MPP/ACP transactions (not public).
- Whether Connect destination-charge `application_fee_amount` works cleanly
  against MPP-settled PaymentIntents on Tempo USDC (likely yes via the SPT
  bridge, but unconfirmed).
- Whether MPP sessions can natively carry a "take rate to third party" hop
  without the carrier being the payment terminus.
- Whether SPT can be issued by *non-Stripe* AI platforms or it's
  Stripe-platform-locked at issuance. The Mastercard/Visa expansion suggests
  the latter is loosening, but the public docs don't confirm cross-platform
  SPT issuance.

These four gaps are the right questions for a Stripe sales/solutions call
before committing the design.

---

## Sources

[1] Stripe blog, *Developing an open standard for agentic commerce*: https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce
[2] ACP GitHub: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
[3] Stripe blog, *10 things we learned building for the first generation of agentic commerce*: https://stripe.com/blog/10-lessons
[4] Stripe newsroom, *Stripe launches the Agentic Commerce Suite* (2025-12-11): https://stripe.com/newsroom/news/agentic-commerce-suite
[5] Stripe docs, *Shared payment tokens*: https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens
[6] Stripe blog, *Supporting additional payment methods for agentic commerce*: https://stripe.com/blog/supporting-additional-payment-methods-for-agentic-commerce
[7] Stripe blog, *Introducing the Machine Payments Protocol*: https://stripe.com/blog/machine-payments-protocol
[8] Stripe docs, *MPP payments*: https://docs.stripe.com/payments/machine/mpp
[9] WorkOS, *x402 vs. Stripe MPP* (2026): https://workos.com/blog/x402-vs-stripe-mpp-how-to-choose-payment-infrastructure-for-ai-agents-and-mcp-tools-in-2026
[10] Visa investor release, *Visa Introduces Trusted Agent Protocol*: https://investor.visa.com/news/news-details/2025/Visa-Introduces-Trusted-Agent-Protocol-An-Ecosystem-Led-Framework-for-AI-Commerce/default.aspx
[11] TAP GitHub: https://github.com/visa/trusted-agent-protocol
[12] Stripe docs, *Using manual payouts*: https://docs.stripe.com/connect/manual-payouts
[13] Stripe resources, *Fiat-Backed Stablecoins: Payments, Treasury, and Risk*: https://stripe.com/resources/more/fiat-backed-stablecoins
[14] Stripe docs, *Create destination charges*: https://docs.stripe.com/connect/destination-charges
[15] Fortune, *Stripe-backed crypto startup Tempo releases AI payments protocol* (2026-03-18): https://fortune.com/2026/03/18/stripe-tempo-paradigm-mpp-ai-payments-protocol/
[16] Stripe Sessions 2026 announcements: https://stripe.com/blog/everything-we-announced-at-sessions-2026
