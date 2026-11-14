import type { Metadata } from "next";
import { SiteShell, Closing } from "@/components/site/site-shell";
import { ProductScenes } from "@/components/site/product-scenes";
export const metadata: Metadata = {
  title: "Why Foliage · Your work deserves a record",
  description:
    "The product thesis: a living work record, grounded pride and evidence-backed understanding. The portfolio is a projection of the record.",
};
export default function WhyFoliage() {
  return (
    <SiteShell current="/why-foliage">
      <main id="main">
        <header className="record-manifesto-intro">
          <h1>
            The work is bigger
            <br />
            than the highlight reel.
          </h1>
          <p className="record-lede">
            Foliage starts with a simple belief:
            <br />
            your work deserves to be understood.
          </p>
        </header>
        <ProductScenes initial="import" />
        <div className="record-essay-layout">
          <nav className="record-essay-index" aria-label="In this thesis">
            <a href="#record">The record comes first</a>
            <a href="#journey">The builder’s journey</a>
            <a href="#reflection">Grounded pride</a>
            <a href="#evidence">Evidence &amp; value</a>
            <a href="#source">Our product test</a>
          </nav>
          <article className="record-essay">
            <section id="record">
              <h2>The record comes first.</h2>
              <p>
                Foliage is the individual source of truth for a builder’s work:
                projects, contributions, decisions, outcomes, discoveries and
                the evidence beneath them.
              </p>
              <p>
                The portfolio is not the underlying product. It is a selective
                view of the work record. Recruiting, networking, freelancing,
                startup storytelling and coaching can grow from that same
                source.
              </p>
              <p>
                AI makes abundant output possible. It does not automatically
                make the output understandable. What mattered? What did you
                learn? What did you prevent? What should happen next?
              </p>
              <p>Foliage exists to recover that signal.</p>
            </section>
            <section id="journey">
              <h2>The journey matters.</h2>
              <p>
                What you believed. What you chose. What you tried. What
                happened. What you learned. What you changed. What resulted.
                What you discovered.
              </p>
              <p>
                A record should preserve the alternatives, obstacles, avoided
                failures and pivots that give the result meaning. Unfinished
                work belongs. So does careful maintenance, refinement and
                choosing to continue something you love.
              </p>
              <blockquote>
                A failed assumption is not missing history.
                <br />
                The pivot is part of the evidence.
              </blockquote>
              <p>
                Photosynthesis is the capture and transformation layer. Leaflets
                are smaller units of meaningful work; they compound into richer
                Leaves. The metaphor should help a person understand their work,
                rather than force it into unnecessary terminology.
              </p>
            </section>
            <section id="reflection">
              <h2>Pride with something behind it.</h2>
              <p>
                There is a particular satisfaction in seeing your work
                represented truthfully: the effort, decisions, passion and
                persistence that usually disappear.
              </p>
              <p>
                That is grounded pride. The point is to recognize what the work
                took, and share it without reducing it to status signaling.
                Foliage asks what your work means and why you pursued it,
                without turning the answer into a personality assessment.
              </p>
              <p>
                Daily and weekly reflection should make that understanding
                available while the work is happening. A concise account can
                hold important decisions, changed assumptions, discoveries,
                unresolved questions and useful next directions. It should open
                into deeper evidence.
              </p>
              <p>
                Meaningful compression is the goal. An activity total is not a
                substitute.
              </p>
            </section>
            <section id="evidence">
              <h2>
                Credibility comes from
                <br />
                what you can inspect.
              </h2>
              <p>
                Measured facts, external validation, self-reported accounts and
                AI inference are different kinds of support. The record should
                make those differences visible.
              </p>
              <p>
                AI should help reveal and interpret credibility that can be
                traced to evidence. It should not manufacture it.
              </p>
              <h3>What was the work worth?</h3>
              <p>
                Value can mean craftsmanship, good judgment, learning, customer
                outcomes, time saved, revenue created, costs avoided or risk
                reduced. When an estimate is appropriate, its assumptions and
                uncertainty belong beside it. False precision and personal
                rankings do not.
              </p>
              <details>
                <summary>How current attribution states differ</summary>
                <dl className="record-proof">
                  <div>
                    <dt>Verified</dt>
                    <dd>
                      Git accepted a signature and bound the signer to a
                      declared identity.
                    </dd>
                  </div>
                  <div>
                    <dt>Pending</dt>
                    <dd>
                      Attributed to a declared identity; authorship is not
                      cryptographically established.
                    </dd>
                  </div>
                  <div>
                    <dt>Excluded</dt>
                    <dd>
                      Could not be attributed to this person. Its reason stays
                      with the record.
                    </dd>
                  </div>
                </dl>
                <p>
                  These states describe attribution. They do not establish the
                  value of someone’s work or independently verify every outcome.
                </p>
              </details>
            </section>
            <section>
              <h2>Private truth. Public view.</h2>
              <p>
                The private record can hold experiments, failures, uncertainty
                and difficult decisions. Public views should select the
                relevant, permitted material for their audience.
              </p>
              <p>
                Another builder might need architecture and tradeoffs. A hiring
                manager might need ownership and outcomes. A client might need
                delivery evidence. A founder, collaborator, investor or coach
                might need to understand how thinking evolved. Each view comes
                from the same underlying record.
              </p>
              <p>
                Foliage does not start by becoming another professional social
                network. The center is meaningful work. Connections can follow.
              </p>
            </section>
            <section id="source">
              <h2>
                We have to recognize
                <br />
                our own journey first.
              </h2>
              <p>
                The founder’s multi-year Foliage journey is the first demanding
                product test: years of projects, pivots, assumptions, artifacts,
                passions, discoveries and outcomes.
              </p>
              <p>
                Can the builder recognize what they did, what it took and what
                mattered? Can someone else independently inspect an appropriate
                view and understand why its claims deserve trust?
              </p>
              <p>Both tests matter.</p>
              <p className="record-caption">
                Adapted from the founder’s canonical “Foliage — Language &amp;
                Product Framing,” supplied September 23, 2026. This is the
                product thesis; the availability notes on Photosynthesis and
                Getting started distinguish current tools from future direction.
              </p>
            </section>
          </article>
        </div>
        <Closing title="Keep the work. Keep its meaning." />
      </main>
    </SiteShell>
  );
}
