import "./styles.css";
import { DATA } from "./engine";
import { renderHero } from "./sections/hero";
import { renderScenario } from "./sections/scenario";
import { renderLaTable } from "./sections/laTable";
import { renderLcRegions } from "./sections/lcRegions";
import { renderFlows } from "./sections/flows";
import { renderAbout } from "./sections/about";

function mount(id: string, render: (el: HTMLElement) => void) {
  const el = document.getElementById(id);
  if (el) render(el);
}

mount("hero", renderHero);
mount("scenario", renderScenario);
mount("assembly", renderLaTable);
mount("council", renderLcRegions);
mount("flows", renderFlows);
mount("about", renderAbout);

const footerMeta = document.getElementById("footer-meta");
if (footerMeta) {
  footerMeta.textContent = `${DATA.meta.source} · last updated ${DATA.meta.lastUpdated}`;
}
