import type { Theme } from "@mariozechner/pi-coding-agent";

const PI_ART = [
	"    3.141592653589793238462643383279",
	"   5028841971693993751058209749445923",
	"  07816406286208998628034825342117067",
	"  9821    48086         5132",
	" 823      06647        09384",
	"46        09550        58223",
	"          1725         3594",
	"         08128        48111",
	"        74502         84102",
	"       70193          85211        05",
	"     5596446           22948954930381",
	"    9644288             10975665933",
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	h = ((h % 360) + 360) % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const RESET = "\x1b[0m";

function rainbowLine(line: string, rowOffset: number): string {
	const totalChars = 50;
	let result = "";
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!;
		if (ch === " ") {
			result += " ";
			continue;
		}
		const hue = ((i + rowOffset * 3) / totalChars) * 360;
		const [r, g, b] = hslToRgb(hue, 0.85, 0.65);
		result += `\x1b[38;2;${r};${g};${b}m${ch}`;
	}
	return result + RESET;
}

export function renderBannerLines(_theme: Theme, width: number): string[] {
	const maxLen = Math.max(...PI_ART.map((line) => line.length));
	const pad = Math.max(0, Math.floor((width - maxLen) / 2));
	const prefix = " ".repeat(pad);
	return ["", ...PI_ART.map((line, row) => prefix + rainbowLine(line, row)), ""];
}
