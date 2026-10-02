/** Phosphor duotone icons; direct SSR imports work in both server and client components. */
import { ArrowsOutSimpleIcon } from '@phosphor-icons/react/dist/ssr/ArrowsOutSimple';
import { ArrowsInSimpleIcon } from '@phosphor-icons/react/dist/ssr/ArrowsInSimple';
import { ArrowDownIcon } from '@phosphor-icons/react/dist/ssr/ArrowDown';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowRight';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
import { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
import { TrayIcon } from '@phosphor-icons/react/dist/ssr/Tray';
import { ChatTeardropTextIcon } from '@phosphor-icons/react/dist/ssr/ChatTeardropText';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
import { XIcon } from '@phosphor-icons/react/dist/ssr/X';
import { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/ssr/CheckCircle';
import { CopySimpleIcon } from '@phosphor-icons/react/dist/ssr/CopySimple';
import { ShieldCheckIcon } from '@phosphor-icons/react/dist/ssr/ShieldCheck';
import { LockKeyIcon } from '@phosphor-icons/react/dist/ssr/LockKey';
import { EyeIcon } from '@phosphor-icons/react/dist/ssr/Eye';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/ssr/EyeSlash';
import { DeviceMobileIcon } from '@phosphor-icons/react/dist/ssr/DeviceMobile';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowsClockwise';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/ssr/ListBullets';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/ssr/UsersThree';
import { AtIcon } from '@phosphor-icons/react/dist/ssr/At';
import { ClockIcon } from '@phosphor-icons/react/dist/ssr/Clock';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
import { SignOutIcon } from '@phosphor-icons/react/dist/ssr/SignOut';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/ssr/WarningCircle';
import { PauseIcon } from '@phosphor-icons/react/dist/ssr/Pause';

const icons = {
  expand: ArrowsOutSimpleIcon,
  collapse: ArrowsInSimpleIcon,
  down: ArrowDownIcon,
  arrow: ArrowRightIcon,
  back: ArrowLeftIcon,
  upRight: ArrowUpRightIcon,
  inbox: TrayIcon,
  message: ChatTeardropTextIcon,
  search: MagnifyingGlassIcon,
  close: XIcon,
  check: CheckIcon,
  connected: CheckCircleIcon,
  duplicates: CopySimpleIcon,
  shield: ShieldCheckIcon,
  lock: LockKeyIcon,
  eye: EyeIcon,
  eyeOff: EyeSlashIcon,
  phone: DeviceMobileIcon,
  refresh: ArrowsClockwiseIcon,
  activity: ListBulletsIcon,
  users: UsersThreeIcon,
  at: AtIcon,
  clock: ClockIcon,
  send: PaperPlaneTiltIcon,
  logout: SignOutIcon,
  alert: WarningCircleIcon,
  pause: PauseIcon,
};

export type IconName = keyof typeof icons;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const Glyph = icons[name];
  return (
    <Glyph className={`icon ${className}`} weight="duotone" aria-hidden="true" focusable="false" />
  );
}
