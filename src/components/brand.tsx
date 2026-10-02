/** Original WareOnGo artwork shared by public access and the authenticated workspace. */
import Image from 'next/image';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-logo">
        <Image
          src="/images/wareongo-logo.png"
          alt="WareOnGo"
          width={1000}
          height={1000}
          sizes="112px"
          loading="eager"
        />
      </span>
      <span className="brand-product">Ramesh</span>
    </span>
  );
}
