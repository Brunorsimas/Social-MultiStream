export type ThemeColors = {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceHighlight: string;
  primary: string;
  primaryDim: string;
  secondary: string;
  accent: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderLight: string;
  success: string;
  warning: string;
  error: string;
  twitch: string;
  youtube: string;
  kick: string;
  facebook: string;
  tiktok: string;
  overlay: string;
};

const Colors: { dark: ThemeColors; light: ThemeColors } = {
  dark: {
    background: "#0A0A0F",
    surface: "#14141F",
    surfaceElevated: "#1C1C2E",
    surfaceHighlight: "#252540",
    primary: "#00D4FF",
    primaryDim: "#0098B8",
    secondary: "#7B61FF",
    accent: "#FF3D71",
    text: "#FFFFFF",
    textSecondary: "#8F8FA3",
    textMuted: "#5A5A72",
    border: "#2A2A40",
    borderLight: "#1E1E32",
    success: "#00E676",
    warning: "#FFB74D",
    error: "#FF5252",
    twitch: "#9146FF",
    youtube: "#FF0000",
    kick: "#53FC18",
    facebook: "#1877F2",
    tiktok: "#EE1D52",
    overlay: "rgba(0, 0, 0, 0.7)",
  },
  light: {
    background: "#F5F6FA",
    surface: "#FFFFFF",
    surfaceElevated: "#F0F1F5",
    surfaceHighlight: "#E4E6EE",
    primary: "#0098B8",
    primaryDim: "#007A96",
    secondary: "#6246EA",
    accent: "#E5325D",
    text: "#1A1A2E",
    textSecondary: "#5C5C72",
    textMuted: "#9999AD",
    border: "#D8DAE5",
    borderLight: "#E8E9F0",
    success: "#00B85C",
    warning: "#E69500",
    error: "#D63B3B",
    twitch: "#9146FF",
    youtube: "#FF0000",
    kick: "#3DC710",
    facebook: "#1877F2",
    tiktok: "#EE1D52",
    overlay: "rgba(0, 0, 0, 0.4)",
  },
};

export default Colors;
