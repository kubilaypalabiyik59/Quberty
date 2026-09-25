'use client';

import { motion, useScroll, useTransform, type MotionStyle } from 'framer-motion';
import { LoginStage } from '@/components/brand/LoginStage';
import { MosaicField } from '@/app/(landing)/_components/MosaicField';
import styles from './landing.module.css';

/**
 * The landing page's scroll-driven stage. It paints the sign-in stage look over the brand
 * stage and reveals the mosaic as the visitor scrolls the hero away.
 */
export function LandingStage() {
  const { scrollY, scrollYProgress } = useScroll();

  const heroProgress = useTransform(scrollY, (y) =>
    typeof window === 'undefined' ? 0 : Math.min(y / (window.innerHeight * 0.8), 1),
  );

  return (
    <motion.div
      className={styles.scrollStage}
      style={{ '--p': heroProgress, '--q': scrollYProgress } as MotionStyle}
    >
      <LoginStage>
        <MosaicField className={styles.mosaic} />
      </LoginStage>
    </motion.div>
  );
}
