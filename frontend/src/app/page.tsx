import { redirect } from 'next/navigation';

/**
 * The app's front door goes to the dashboard. The ERP layout sends anyone
 * without a live session on to /login, so an already signed-in user is not
 * asked to sign in again just for opening the site.
 */
export default function HomePage() {
  redirect('/dashboard');
}
