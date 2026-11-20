/** Eight-week trend. No axes. A dashed line marks the target. */
export function Sparkline({
  values,
  target,
  label,
}: {
  values: (number | null)[];
  target: number | null;
  label: string;
}) {
  const width = 100;
  const height = 28;
  const points = values.flatMap((value, index) => (value == null ? [] : [{ index, value }]));
  const nums = points.map((point) => point.value);
  const sample = target == null ? nums : [...nums, target];

  if (sample.length === 0) {
    return <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" role="img" aria-label={label} />;
  }

  const low = Math.min(...sample);
  const high = Math.max(...sample);
  const pad = (high - low || 1) * 0.15;
  const y = (value: number) => height - ((value - (low - pad)) / (high + pad - (low - pad))) * height;
  const x = (index: number) => (values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width);

  const paths: string[] = [];
  let path = "";
  points.forEach((point, i) => {
    const prev = points[i - 1];
    const connected = prev != null && prev.index === point.index - 1 && path !== "";
    if (!connected && path) {
      paths.push(path);
      path = "";
    }
    path += `${connected ? "L" : "M"}${x(point.index).toFixed(2)},${y(point.value).toFixed(2)}`;
  });
  if (path) paths.push(path);

  const targetY = target == null ? null : y(target);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" role="img" aria-label={label}>
      {targetY != null && (
        <line x1={0} x2={width} y1={targetY} y2={targetY} stroke="var(--fg-3)" strokeDasharray="2 2" strokeWidth="1" />
      )}
      {paths.map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}
