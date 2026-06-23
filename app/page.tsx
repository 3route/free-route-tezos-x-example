// / — canonical Buyer route is /buyer; redirect the root there.
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/buyer');
}
