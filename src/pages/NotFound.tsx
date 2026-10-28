import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="section">
      <div className="wrap narrow center">
        <h2>Page not found</h2>
        <p className="dim">That route does not exist.</p>
        <Link className="btn btn-primary" to="/">
          Back home
        </Link>
      </div>
    </section>
  );
}
