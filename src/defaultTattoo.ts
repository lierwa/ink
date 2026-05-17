const defaultTattooSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 260">
  <g fill="none" stroke="#0b0b0b" stroke-linecap="round" stroke-linejoin="round">
    <path stroke-width="7" d="M254 42c31 23 50 53 57 90 8 44-5 76-41 98-37-20-53-52-47-96 5-39 15-67 31-92Z"/>
    <path stroke-width="5" d="M270 230c-25-35-34-71-27-108 6-31 19-56 39-75"/>
    <path stroke-width="5" d="M270 230c24-35 32-70 24-107-7-31-19-56-36-76"/>
    <path stroke-width="5" d="M126 122c44-47 88-60 132-39 28 14 48 38 60 73-37 18-75 19-115 4-33-12-59-25-77-38Z"/>
    <path stroke-width="5" d="M411 116c-46-40-91-49-134-26-27 15-45 41-55 76 39 15 77 13 116-5 32-15 56-30 73-45Z"/>
    <path stroke-width="4" d="M152 122c38-10 75-8 112 8"/>
    <path stroke-width="4" d="M390 116c-37-7-73-2-108 16"/>
    <path stroke-width="4" d="M80 101c41-21 82-24 123-7"/>
    <path stroke-width="4" d="M318 90c44-22 86-23 126-3"/>
    <path stroke-width="4" d="M72 154c50 5 91-3 123-24"/>
    <path stroke-width="4" d="M326 134c35 18 76 22 122 12"/>
    <path stroke-width="3" d="M189 68c14-22 33-37 59-43"/>
    <path stroke-width="3" d="M333 62c-16-18-37-30-63-36"/>
    <path stroke-width="3" d="M216 202c14 20 32 33 55 40"/>
    <path stroke-width="3" d="M322 198c-12 21-29 35-52 44"/>
    <path stroke-width="3" d="M259 72c14 19 20 41 18 67-2 24-9 44-21 62"/>
    <path stroke-width="3" d="M275 74c-13 20-18 42-15 67 3 24 12 43 26 59"/>
    <path stroke-width="3" d="M52 125c31-13 62-14 92-2"/>
    <path stroke-width="3" d="M466 113c-29-11-58-10-88 4"/>
    <path stroke-width="3" d="M101 82c26-4 51 0 75 12"/>
    <path stroke-width="3" d="M420 76c-25-2-49 3-72 17"/>
  </g>
  <g fill="#0b0b0b">
    <circle cx="270" cy="132" r="6"/>
    <circle cx="250" cy="132" r="4"/>
    <circle cx="290" cy="132" r="4"/>
    <circle cx="126" cy="122" r="5"/>
    <circle cx="411" cy="116" r="5"/>
  </g>
</svg>`;

export const defaultTattooSize = {
  width: 520,
  height: 260,
} as const;

export const defaultTattooDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(defaultTattooSvg)}`;
