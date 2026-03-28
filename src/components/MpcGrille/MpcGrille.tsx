import styles from './MpcGrille.module.css';

interface MpcGrilleProps {
  side: 'left' | 'right';
}

export function MpcGrille({ side }: MpcGrilleProps) {
  return (
    <div className={`${styles.grille} ${side === 'left' ? styles.left : styles.right}`}>
      <div className={styles.group}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className={styles.slot} />
        ))}
      </div>
      <div className={styles.group}>
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className={styles.slot} />
        ))}
      </div>
    </div>
  );
}
