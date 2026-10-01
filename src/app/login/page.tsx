/** Public login shell; no worker or pairing data is fetched before authentication. */
import { LoginForm } from '../../components/login-form';
import { Brand } from '../../components/brand';
import { Icon } from '../../components/icon';

export default function LoginPage() {
  return (
    <div className="login-shell">
      <header className="login-header">
        <Brand />
        <span className="access-label">
          <Icon name="lock" /> Private workspace
        </span>
      </header>
      <main className="login-main" id="main-content">
        <section className="login-editorial" aria-label="Meet your Ramesh workspace">
          <div className="login-editorial-copy">
            <span className="eyebrow">A LITTLE CLOSER TO EVERY CONVERSATION</span>
            <h2>
              Good conversations.
              <br />
              Great connections.
            </h2>
            <p>
              A thoughtful workspace for the people
              <br className="desktop-break" /> and places that keep business moving.
            </p>
          </div>
          <div className="login-photo">
            <div className="login-floating-card">
              <span className="floating-card-icon">
                <Icon name="message" />
              </span>
              <div>
                <span className="small-label">MEET RAMESH</span>
                <strong>Your conversations, together.</strong>
                <p>One inbox. A little more clarity.</p>
              </div>
              <Icon name="upRight" />
            </div>
            <span className="photo-caption">SPACES FOR BUSINESS. ROOM FOR CONNECTION.</span>
          </div>
        </section>
        <section className="login-access" aria-labelledby="login-title">
          <div className="login-card">
            <span className="login-lock">
              <Icon name="lock" />
            </span>
            <span className="eyebrow">YOUR RAMESH WORKSPACE</span>
            <h1 id="login-title">Welcome back.</h1>
            <p className="muted">Sign in to keep your conversations moving.</p>
            <LoginForm />
            <div className="login-help">
              <Icon name="shield" />
              <p>
                For the WareOnGo team.
                <br />
                <span>Need access? Contact your workspace administrator.</span>
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="login-footer">
        <span>WareOnGo · Made for better connections.</span>
        <span>Ramesh admin workspace</span>
      </footer>
    </div>
  );
}
