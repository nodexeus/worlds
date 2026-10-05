const book = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2z"/></svg>'
const campus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5"/></svg>'

/** Add campus wayfinding and the unconnected shared-knowledge space.
 * @param {HTMLElement} hud
 * @param {() => void} onEnterLibrary
 * @returns {{openLibrary: () => void, closeLibrary: () => void}}
 */
export function installCampusShell(hud, onEnterLibrary) {
  const shell = document.createElement('div')
  shell.className = 'campus-shell'
  shell.innerHTML = `
    <header class="campus-bar panel">
      <div class="campus-identity">
        <img src="${import.meta.env.BASE_URL}brand/nodexeus-mark.svg" alt="" width="48" height="48">
        <span>Nodexeus <strong>Worlds</strong></span>
      </div>
      <nav aria-label="Worlds views">
        <button type="button" class="campus-view" data-campus-view="campus" aria-pressed="true">${campus} Campus</button>
        <button type="button" class="campus-view" data-campus-view="library" aria-pressed="false" aria-controls="campus-library">${book} Library</button>
      </nav>
    </header>
    <section id="campus-library" class="campus-library panel" aria-labelledby="library-title" tabindex="-1" hidden>
      <div class="library-heading"><h1 id="library-title">Library</h1><button class="btn icon" type="button" data-library-close aria-label="Close Library"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <p class="library-intro">A shared place for what your agents know.</p>
      <div class="library-empty">
        <span class="library-book">${book}</span>
        <h2>Your shelves are ready.</h2>
        <p>No knowledge sources are connected to this campus yet.</p>
        <span class="library-connection">Not connected</span>
      </div>
      <h2 class="library-section-title">A place for shared knowledge</h2>
      <p class="library-note">The Library is the planned home for sources, lasting memory, and the knowledge your agents can retrieve.</p>
      <dl class="library-capabilities">
        <div><dt>Sources</dt><dd>Documents, runbooks, and references, with their origin and freshness visible.</dd></div>
        <div><dt>Shared memory</dt><dd>Decisions and learned context that can stay with your team across agent runs.</dd></div>
        <div><dt>Access &amp; retrieval</dt><dd>Who can use each collection, and evidence of what an agent actually retrieved.</dd></div>
      </dl>
      <p class="library-footnote">Platform connection is coming in a future release. Local session monitoring is available now.</p>
      <button type="button" class="btn" data-library-return>${campus} Return to campus</button>
    </section>`
  hud.appendChild(shell)
  const panel = shell.querySelector('#campus-library')
  const buttons = [...shell.querySelectorAll('[data-campus-view]')]
  const libraryButton = buttons.find(button => button.dataset.campusView === 'library')

  /** Switch views without rebuilding or moving the world.
   * @param {boolean} open
   * @param {boolean} restoreFocus
   * @returns {void}
   */
  function showLibrary(open, restoreFocus = false) {
    panel.hidden = !open
    hud.classList.toggle('library-open', open)
    for (const button of buttons) button.setAttribute('aria-pressed', String((button.dataset.campusView === 'library') === open))
    if (open) { panel.scrollTop = 0; panel.focus({ preventScroll: true }); onEnterLibrary() }
    else if (restoreFocus) libraryButton.focus({ preventScroll: true })
  }

  for (const button of buttons) button.addEventListener('click', () => showLibrary(button.dataset.campusView === 'library'))
  for (const button of shell.querySelectorAll('[data-library-close], [data-library-return]')) {
    button.addEventListener('click', () => showLibrary(false, true))
  }
  shell.addEventListener('keydown', event => {
    // Do not let the world's shortcuts consume Space/Enter or Escape inside this view.
    event.stopPropagation()
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); showLibrary(false, true) }
  })
  return { openLibrary: () => showLibrary(true), closeLibrary: () => showLibrary(false) }
}
