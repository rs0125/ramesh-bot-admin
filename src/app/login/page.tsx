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
          <Icon name="lock" /> Admin access
        </span>
      </header>
      <main className="login-main" id="main-content">
        <section className="login-editorial" aria-label="About Ramesh admin">
          <div className="login-editorial-copy">
            <h2>
              Manage WhatsApp
              <br />
              with Ramesh.
            </h2>
            <p>Read conversations, send replies, and manage the connection.</p>
          </div>
          <div className="login-photo" aria-hidden="true" />
        </section>
        <section className="login-access" aria-labelledby="login-title">
          <div className="login-card">
            <span className="login-lock">
              <Icon name="lock" />
            </span>
            <h1 id="login-title">Sign in to Ramesh</h1>
            <LoginForm />
            <div className="login-help">
              <Icon name="shield" />
              <p>Need the password? Ask your administrator.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
