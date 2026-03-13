import { useState } from "react";
import { Header } from "./components/Header";
import { MobileMenu } from "./components/MobileMenu";
import { SettingsPageNew } from "./components/SettingsPageNew";
import { AnimatedBackground } from "./components/AnimatedBackground";

export default function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedBackground />
      <Header onMenuClick={() => setIsMobileMenuOpen(true)} />
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />
      <SettingsPageNew />
    </div>
  );
}