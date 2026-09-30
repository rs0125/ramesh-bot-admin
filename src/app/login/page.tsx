/** Public login shell; no worker or pairing data is fetched before authentication. */
import { LoginForm } from '../../components/login-form';

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="login-brand">
        <span className="brand-mark">w.</span>
        <span>
          WareOnGo <span className="muted">/ Sales bot</span>
        </span>
      </div>
      <section className="login-card">
        <span className="eyebrow">WORKSPACE ACCESS</span>
        <h1>
          Your sales team,
          <br />
          connected.
        </h1>
        <p className="muted">
          Sign in to manage the WhatsApp connection and keep an eye on your bot.
        </p>
        <LoginForm />
      </section>
      <p className="login-footer">WareOnGo · Internal tools</p>
    </main>
  );
}
