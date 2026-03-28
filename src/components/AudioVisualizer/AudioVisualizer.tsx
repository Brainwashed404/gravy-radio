import { motion } from 'framer-motion';
import styles from './AudioVisualizer.module.css';

interface AudioVisualizerProps {
  isActive: boolean;
  barCount?: number;
}

const BAR_SEQUENCES = [
  ['20%', '80%', '40%', '95%', '30%', '70%', '20%'],
  ['60%', '30%', '90%', '15%', '80%', '45%', '60%'],
  ['40%', '70%', '25%', '85%', '50%', '35%', '40%'],
  ['80%', '20%', '65%', '35%', '90%', '55%', '80%'],
  ['35%', '90%', '50%', '70%', '20%', '85%', '35%'],
];

export function AudioVisualizer({ isActive, barCount = 5 }: AudioVisualizerProps) {
  return (
    <div className={styles.visualizer}>
      {Array.from({ length: barCount }).map((_, i) => (
        <motion.div
          key={i}
          className={styles.bar}
          animate={
            isActive
              ? { height: BAR_SEQUENCES[i % BAR_SEQUENCES.length] }
              : { height: '20%' }
          }
          transition={
            isActive
              ? {
                  duration: 0.7 + i * 0.1,
                  repeat: Infinity,
                  ease: 'linear',
                  delay: i * 0.12,
                }
              : { duration: 0.3 }
          }
        />
      ))}
    </div>
  );
}
