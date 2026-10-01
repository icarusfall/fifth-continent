import './desk.css';
import { rememberShell } from '../shell';

// The Smuggler's Table (spec §20.4). D0 lays the foundations only: this shell
// exists, is reached by `?desk`, and says plainly that it is being built. D1
// brings the table itself.
export default function DeskApp() {
  return (
    <main className="desk-wip">
      <h1>The Smuggler&rsquo;s Table</h1>
      <p>The desktop table is being built. Your tenancy is safe: it plays on in the phone layout.</p>
      <button type="button" onClick={() => rememberShell('phone')}>
        Play in the phone layout
      </button>
    </main>
  );
}
