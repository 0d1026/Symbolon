import { Reveal, Rise } from "../components/Reveal";
import { CopyBlock } from "../components/Bits";
import { LiveCheck } from "../components/LiveCheck";
import { MODEL_KEY, PROFILE, VERIFIER, VERIFIER_HASH, WALLET, REPO } from "../data/chain";
import { view, viewAccount, viewKeys } from "../lib/near";

const CURL1 = `curl -s https://test.rpc.fastnear.com -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"${WALLET}","method_name":"is_key_valid","args_base64":"eyJhZGRyZXNzIjoiMHgzYjc1M2I0NDA2NjEzYzVlNzBhZTY0MDUwODYzMmI2MDA0MjRmYTBjIiwicHJvZmlsZSI6InotYWkvZ2xtLTUuMy1mbGFzaCJ9"}}' | python3 -c "import sys,json;print(bytes(json.load(sys.stdin)['result']['result']).decode())"`;

export default function Verify() {
  return (
    <main className="page">
      <header className="phead">
        <span className="eyebrow mono">No keys or accounts needed</span>
        <Reveal as="h1" text="Don't trust us.|*Check.*" wait />
        <p className="lede">Three checks. The last two run right here.</p>
      </header>

      <ol className="vsteps">
        <li>
          <Rise>
            <div className="vn mono">01</div>
            <h3>Build it and run the tests</h3>
            <p>About 3 minutes. Needs <code>rustup</code>, <code>curl</code> and <code>python3</code>.</p>
            <CopyBlock label="terminal" code={`git clone ${REPO}.git\ncd Symbolon\ncargo install cargo-near@0.23.0 --locked\n./scripts/build.sh\ncd contract\nRUST_TEST_THREADS=3 cargo test`} />
            <p className="expect mono">Expect: 56 tests pass.</p>
          </Rise>
        </li>
        <li>
          <Rise>
            <div className="vn mono">02</div>
            <h3>Is the model's key registered on chain?</h3>
            <p>The wallet only trusts keys that passed the Intel verifier.</p>
            <LiveCheck
              label="is_key_valid"
              cmd={`${WALLET}.is_key_valid({ address: "${MODEL_KEY}", profile: "${PROFILE}" })`}
              expect="true"
              run={async () => String(await view<boolean>(WALLET, "is_key_valid", { address: MODEL_KEY, profile: PROFILE }))}
            />
            <details className="more"><summary className="mono">Same check with curl</summary><CopyBlock label="terminal" code={CURL1} /></details>
          </Rise>
        </li>
        <li>
          <Rise>
            <div className="vn mono">03</div>
            <h3>Is the verifier the mainnet code, and locked?</h3>
            <p>Testnet runs an identical copy of the mainnet verifier, with its only key deleted.</p>
            <LiveCheck
              label="view_account · code hash"
              cmd={`view_account ${VERIFIER}`}
              expect={VERIFIER_HASH}
              run={async () => { const a = await viewAccount(VERIFIER); return `code_hash ${a.code_hash}`; }}
            />
            <LiveCheck
              label="view_access_key_list · no keys"
              cmd={`view_access_key_list ${VERIFIER}`}
              expect="keys: 0"
              run={async () => { const k = await viewKeys(VERIFIER); return `keys: ${k.keys.length}`; }}
            />
            <p className="expect mono">Expect: this code hash and no keys.</p>
          </Rise>
        </li>
      </ol>
    </main>
  );
}
