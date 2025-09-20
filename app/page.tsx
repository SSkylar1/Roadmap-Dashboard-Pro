// app/page.tsx (SERVER COMPONENT – no "use client")
export const dynamic = 'force-dynamic'; // or: export const revalidate = 0;

import HomeClient from "./HomeClient";

export default function Page() {
  return <HomeClient />;
}



