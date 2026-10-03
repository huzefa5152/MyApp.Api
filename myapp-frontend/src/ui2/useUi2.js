import { useUiTheme } from "./UiThemeContext";

/** True when the signed-in user's theme uses the redesigned ("workspace") screen structure. */
export default function useUi2() {
  return useUiTheme().theme.layout === "workspace";
}
