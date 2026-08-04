import QRCode from "qrcode";

export function createQrCodeSvg(deepLink: string): Promise<string> {
  return QRCode.toString(deepLink, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 1,
    color: {
      dark: "#333333ff",
      light: "#ffffffff",
    },
  });
}
