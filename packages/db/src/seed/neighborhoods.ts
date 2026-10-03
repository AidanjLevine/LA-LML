/** Launch neighborhoods. Centers are approximate (x = longitude, y = latitude); boundaries come later. */
export const NEIGHBORHOODS = [
  { slug: "echo-park", name: "Echo Park", region: "eastside", center: { x: -118.2606, y: 34.0782 }, zoom: 14 },
  { slug: "silver-lake", name: "Silver Lake", region: "eastside", center: { x: -118.2702, y: 34.0869 }, zoom: 14 },
  { slug: "koreatown", name: "Koreatown", region: "central", center: { x: -118.3008, y: 34.0618 }, zoom: 14 },
  { slug: "westlake", name: "Westlake", region: "central", center: { x: -118.277, y: 34.059 }, zoom: 14 },
  { slug: "west-hollywood", name: "West Hollywood", region: "westside", center: { x: -118.3617, y: 34.09 }, zoom: 14 },
  { slug: "santa-monica", name: "Santa Monica", region: "westside", center: { x: -118.4912, y: 34.0195 }, zoom: 13 },
  { slug: "venice", name: "Venice", region: "westside", center: { x: -118.4695, y: 33.985 }, zoom: 14 },
] as const;
