import { TLink } from "../components/TLink";
import { Token } from "../components/Token";

export default function NotFound() {
  return (
    <main className="page nf">
      <Token state="break" />
      <h1>No page <em>fits here.</em></h1>
      <p className="lede">The address you followed doesn't match any page.</p>
      <TLink to="/" className="btn"><span>Back to the start</span><i>→</i></TLink>
    </main>
  );
}
