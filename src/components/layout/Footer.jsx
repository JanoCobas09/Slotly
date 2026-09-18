export default function Footer() {
  return (
    <footer className="footer">
      {/* Slotly es el producto; SACIA es el estudio que lo desarrolla. */}
      <img src="/img/slotly-icon.svg" alt="Slotly" width="20" height="20" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />
      <span className="footer-brand">Slotly</span>
      <span className="footer-sep">·</span>
      <span>
        por <strong>SACIA</strong>
      </span>
      <span className="footer-sep">·</span>
      <span>{new Date().getFullYear()}</span>
    </footer>
  );
}
