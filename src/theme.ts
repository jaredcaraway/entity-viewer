import { createTheme, type MantineColorsTuple } from '@mantine/core';

const lagoon: MantineColorsTuple = [
  '#e3fbfa', '#d1f2f1', '#a6e3e1', '#77d4d1', '#51c7c4',
  '#39bfbc', '#2bbbb8', '#19a4a2', '#009290', '#007f7c',
];

const ember: MantineColorsTuple = [
  '#fff2e6', '#ffe3cc', '#fcc59b', '#f9a565', '#f78a38',
  '#f5791c', '#f5700c', '#da5f00', '#c25300', '#a94500',
];

// Navy-tinted dark scale instead of Mantine's neutral grays.
const dark: MantineColorsTuple = [
  '#c9d1dc', '#a7b1c0', '#7d8899', '#5a6577', '#3a4456',
  '#2a3344', '#1f2737', '#171e2c', '#111723', '#0b0f18',
];

export const theme = createTheme({
  primaryColor: 'lagoon',
  primaryShade: { light: 7, dark: 5 },
  colors: { lagoon, ember, dark },
  fontFamily:
    '"Inter Variable", Inter, "Segoe UI Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
  headings: { fontWeight: '650' },
  defaultRadius: 'sm',
  fontSizes: { xs: '11px', sm: '12.5px', md: '14px', lg: '16px', xl: '18px' },
  components: {
    Badge: { defaultProps: { variant: 'light', radius: 'xs' }, styles: { root: { textTransform: 'none', fontWeight: 600 } } },
    ActionIcon: { defaultProps: { variant: 'subtle' } },
    Tabs: {
      defaultProps: { variant: 'pills', radius: 'sm' },
      styles: { tab: { padding: '5px 8px', fontSize: 12.5, fontWeight: 550 }, tabSection: { marginInlineEnd: 5 } },
    },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
  },
});

/** Stable color per entity family, used for graph nodes and type badges. */
const FAMILY: [RegExp, string][] = [
  [/Organization|Business|Clinic|Hospital|Physician|Dentist|Store|Restaurant|Corporation|Service|Contractor|Attorney|Agent/, '#f5791c'],
  [/^Person$|Patient/, '#e64980'],
  [/WebSite|WebPage|Page$|SiteNavigation|WPHeader|WPFooter/, '#4c6ef5'],
  [/Article|Posting|CreativeWork|Blog|Review|Video|Image|Media|Book|Course|Recipe|HowTo/, '#7950f2'],
  [/Product|Offer|Rating|Brand|PriceSpecification/, '#2f9e44'],
  [/Place|Address|GeoCoordinates|Country|City|State|Location/, '#1098ad'],
  [/Event/, '#d6336c'],
  [/Breadcrumb|ListItem|ItemList/, '#868e96'],
  [/FAQ|Question|Answer/, '#f59f00'],
  [/Medical|Health|Specialty|Drug|Condition|Procedure/, '#0ca678'],
];
const FALLBACK = ['#5c7cfa', '#20c997', '#fab005', '#ff6b6b', '#845ef7', '#22b8cf'];

export function colorForType(t: string | undefined): string {
  if (!t) return '#adb5bd';
  for (const [re, c] of FAMILY) if (re.test(t)) return c;
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
