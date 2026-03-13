export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Базовый градиент */}
      <div className="absolute inset-0 bg-background" />
      
      {/* Анимированные блобы */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-purple-600/20 dark:bg-purple-500/30 rounded-full blur-3xl animate-blob" />
      <div className="absolute top-1/4 -left-32 w-[600px] h-[600px] bg-blue-400/10 dark:bg-blue-500/20 rounded-full blur-3xl animate-blob animation-delay-2000" />
      <div className="absolute bottom-0 right-0 w-[700px] h-[700px] bg-purple-400/10 dark:bg-purple-600/20 rounded-full blur-3xl animate-blob animation-delay-4000" />
      
      {/* Точечная сетка */}
      <div 
        className="absolute inset-0 opacity-[0.15] dark:opacity-[0.1]"
        style={{
          backgroundImage: 'radial-gradient(rgba(120, 120, 120, 0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />
    </div>
  );
}