// Placeholder card for a section that is built in a later step.
export function laterCard(title, step, lines) {
  return `
    <h1 class="view-title">${title}</h1>
    <section class="card later">
      <div class="hud c-amber">ARRIVES IN STEP ${step}</div>
      ${lines.map((l) => `<p>${l}</p>`).join('')}
    </section>`;
}
