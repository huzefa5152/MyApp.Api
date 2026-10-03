import { MdCheck } from "react-icons/md";
import { useUiTheme } from "./UiThemeContext";

/** Lists every registered theme with a small colour preview; the active one is checked. */
export default function ThemePicker({ onPicked }) {
  const { theme, setTheme, themes } = useUiTheme();
  return (
    <div role="radiogroup" aria-label="Interface theme" className="u2-themes">
      {themes.map((t) => (
        <button key={t.id} type="button" role="radio" aria-checked={t.id === theme.id} className="u2-theme" onClick={() => { setTheme(t.id); onPicked?.(); }}>
          <span className="u2-theme__swatch" aria-hidden="true">
            {t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
          </span>
          <span className="u2-theme__text"><strong>{t.label}</strong><small>{t.description}</small></span>
          {t.id === theme.id && <MdCheck size={16} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
