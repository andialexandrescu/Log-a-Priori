import {CraftButton, CraftButtonLabel, CraftButtonIcon, Button} from "@/components/ui/button"
import {InputReadOnlyDemo} from "@/components/ui/input"
import { ArrowUpRightIcon } from 'lucide-react'
import Image from "next/image";

export default function Home() {
  return (
    <div>
      <div>
        <CraftButton>
          <CraftButtonLabel>Click me</CraftButtonLabel>
          <CraftButtonIcon>
            <ArrowUpRightIcon className='size-3 stroke-2 transition-transform duration-500 group-hover:rotate-45' />
          </CraftButtonIcon>
        </CraftButton>
      </div>
      <div><InputReadOnlyDemo /></div>
    </div>
  );
}
