export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-no-invert
      className="fixed inset-0 overflow-hidden text-slate-900"
      style={{
        fontFamily: 'inherit',
        background: 'linear-gradient(160deg, #eef2ff 0%, #f8fafc 45%, #eef2ff 100%)',
      }}
    >
      {children}
    </div>
  );
}
