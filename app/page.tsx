import RoundsApp from "./rounds-app";

export default function Home() {
  return (
    <main style={{ flex: 1, display: "flex" }}>
      {/* Intentionally no headers/nav; big display + tiny footer controls */}
      {/* Client component required for timer + interactivity */}
      <RoundsApp />
    </main>
  );
}
