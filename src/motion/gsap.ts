import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);

/*
 * Motion grammar. Everything related, nothing identical:
 *   settle — reveals and arrivals: fast start, long soft landing
 *   glide  — objects travelling between two states (symmetrical)
 *   optic  — focus pulls and light: almost instant attack, very long tail
 *   press  — interactive feedback with a small overshoot
 *   depart — things leaving: gentle start, quick exit
 */
CustomEase.create('settle', 'M0,0 C0.16,1 0.3,1 1,1');
CustomEase.create('glide', 'M0,0 C0.65,0 0.35,1 1,1');
CustomEase.create('optic', 'M0,0 C0.08,0.7 0.18,1 1,1');
CustomEase.create('press', 'M0,0 C0.34,1.4 0.64,1 1,1');
CustomEase.create('depart', 'M0,0 C0.55,0 0.9,0.3 1,1');

export const dur = {
  press: 0.16,
  fast: 0.32,
  medium: 0.7,
  slow: 1.2,
  cinematic: 1.8,
} as const;

gsap.defaults({ ease: 'settle', duration: dur.medium });
ScrollTrigger.config({ ignoreMobileResize: true });

export { gsap, ScrollTrigger, SplitText };
