/**
 * `<PalaceScene />` — the 3D canvas that hosts a memory-palace scene.
 *
 * The scene runs inside React Three Fiber's `<Canvas>`. It picks one of three
 * pre-fabricated templates (`house`, `street`, `castle`) and renders the
 * loci on top as floating glowing spheres. The user navigates first-person
 * (drag-to-look + WASD movement); clicking a locus surfaces the underlying
 * card via the `onLocusClick` callback so the parent can render an HTML
 * overlay above the canvas (it stays cheaper than embedding HTML inside
 * the WebGL context via drei's `<Html>`).
 *
 * In editing mode (`mode === "build"`), the floor receives raycasts so the
 * caller can place new loci by clicking on an empty patch of ground.
 *
 * The component is intentionally tolerant of test environments: jsdom has
 * no WebGL, so all of R3F would throw at mount time. We short-circuit via
 * a `<noscript>`-style fallback when the Canvas would crash, gated by
 * detecting absence of WebGL support — keeping the component tree mountable
 * in vitest without elaborate mocks.
 */

import { OrbitControls, Sky, Text } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PalaceLocus, PalaceTemplate } from "@/lib/tauri";

const EYE_HEIGHT = 1.7;
const MOVE_SPEED = 4.0;

interface PalaceSceneProps {
  template: PalaceTemplate;
  loci: PalaceLocus[];
  /** "build" → click-to-place enabled, draggable orbit; "review" → walk only. */
  mode: "build" | "review";
  /**
   * Fires when the user clicks an existing locus marker. The id maps back
   * to `palace_loci.id` so the parent can look up the card.
   */
  onLocusClick?: (locusId: number) => void;
  /**
   * Fires when the user clicks an empty floor tile in build mode. Coords are
   * in world units (Y is fixed near floor level). The parent decides what
   * card gets pinned at the spot.
   */
  onFloorClick?: (xyz: [number, number, number]) => void;
  /** Index (in ordinal order) of the locus currently highlighted (review walk-through). */
  activeLocusIndex?: number;
  /** Optional fixed camera target — when set, OrbitControls pans toward it. */
  cameraTarget?: [number, number, number];
}

/** Detect whether WebGL is available in this environment (jsdom returns false). */
function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

export function PalaceScene(props: PalaceSceneProps) {
  // Skip the heavy R3F mount entirely under jsdom or any environment without
  // WebGL — tests, headless CI, server-side rendering.
  const [supportsWebGL] = useState(() => hasWebGL());
  if (!supportsWebGL) {
    return (
      <div
        data-testid="palace-scene-fallback"
        className="flex h-full w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground"
      >
        Scene 3D indisponible (WebGL non détecté).
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position: [0, EYE_HEIGHT, 6], fov: 70 }} dpr={[1, 1.5]}>
        <SceneContents {...props} />
      </Canvas>
      {props.mode === "build" && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
          Glisser pour pivoter — clic sur le sol pour placer un locus.
        </div>
      )}
      {props.mode === "review" && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
          Z/Q/S/D pour avancer — clic gauche maintenu + glisser pour regarder.
        </div>
      )}
    </div>
  );
}

function SceneContents({
  template,
  loci,
  mode,
  onLocusClick,
  onFloorClick,
  activeLocusIndex,
  cameraTarget,
}: PalaceSceneProps) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[10, 12, 5]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Sky sunPosition={[10, 12, 5]} />
      <SceneTemplate template={template} mode={mode} onFloorClick={onFloorClick} />
      {loci.map((locus, idx) => (
        <LocusMarker
          key={locus.id}
          locus={locus}
          ordinal={idx + 1}
          highlighted={activeLocusIndex === idx}
          onClick={() => onLocusClick?.(locus.id)}
        />
      ))}
      <Controller mode={mode} cameraTarget={cameraTarget} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pre-fabricated scene templates — pure primitives, no GLTF assets needed.
// ---------------------------------------------------------------------------

interface SceneTemplateProps {
  template: PalaceTemplate;
  mode: "build" | "review";
  onFloorClick?: (xyz: [number, number, number]) => void;
}

function SceneTemplate({ template, mode, onFloorClick }: SceneTemplateProps) {
  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (mode !== "build" || !onFloorClick) return;
      // Only react to left-click on the floor mesh.
      if (e.button !== 0) return;
      const p = e.point;
      // Lift the locus a bit above the floor so it's not embedded.
      onFloorClick([p.x, Math.max(p.y + 1.2, 1.2), p.z]);
    },
    [mode, onFloorClick],
  );

  switch (template) {
    case "street":
      return <StreetTemplate onFloorClick={handlePointerDown} />;
    case "castle":
      return <CastleTemplate onFloorClick={handlePointerDown} />;
    default:
      // `house` and `custom` both fall back to the house template (custom
      // GLTF support lands in a follow-up release).
      return <HouseTemplate onFloorClick={handlePointerDown} />;
  }
}

interface TemplatePieceProps {
  onFloorClick: (e: ThreeEvent<PointerEvent>) => void;
}

/** Three rooms, two internal partitions. Earthy palette so loci stand out. */
function HouseTemplate({ onFloorClick }: TemplatePieceProps) {
  return (
    <group>
      {/* Floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onPointerDown={onFloorClick}
      >
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color="#d6c7a8" />
      </mesh>
      {/* Outer walls */}
      <Wall position={[0, 2, -8]} size={[16, 4, 0.2]} color="#e8dcc4" />
      <Wall position={[0, 2, 8]} size={[16, 4, 0.2]} color="#e8dcc4" />
      <Wall position={[-8, 2, 0]} size={[0.2, 4, 16]} color="#e8dcc4" />
      <Wall position={[8, 2, 0]} size={[0.2, 4, 16]} color="#e8dcc4" />
      {/* Internal partitions for 3 rooms */}
      <Wall position={[-2, 2, 0]} size={[0.2, 4, 8]} color="#cdbfa3" />
      <Wall position={[3, 2, 0]} size={[0.2, 4, 8]} color="#cdbfa3" />
    </group>
  );
}

/** Long avenue with regularly-spaced columns and a paved floor. */
function StreetTemplate({ onFloorClick }: TemplatePieceProps) {
  const columns = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let z = -12; z <= 12; z += 4) {
      out.push([-3, z]);
      out.push([3, z]);
    }
    return out;
  }, []);
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onPointerDown={onFloorClick}
      >
        <planeGeometry args={[10, 30]} />
        <meshStandardMaterial color="#9ca3af" />
      </mesh>
      {columns.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 2, z]} castShadow>
          <cylinderGeometry args={[0.3, 0.35, 4, 16]} />
          <meshStandardMaterial color="#f3f4f6" />
        </mesh>
      ))}
    </group>
  );
}

/** A grand single-room castle hall with high walls. */
function CastleTemplate({ onFloorClick }: TemplatePieceProps) {
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onPointerDown={onFloorClick}
      >
        <planeGeometry args={[24, 18]} />
        <meshStandardMaterial color="#857769" />
      </mesh>
      <Wall position={[0, 4, -9]} size={[24, 8, 0.4]} color="#a59685" />
      <Wall position={[0, 4, 9]} size={[24, 8, 0.4]} color="#a59685" />
      <Wall position={[-12, 4, 0]} size={[0.4, 8, 18]} color="#a59685" />
      <Wall position={[12, 4, 0]} size={[0.4, 8, 18]} color="#a59685" />
    </group>
  );
}

function Wall({
  position,
  size,
  color,
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={position} receiveShadow castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Locus markers + camera controller.
// ---------------------------------------------------------------------------

interface LocusMarkerProps {
  locus: PalaceLocus;
  ordinal: number;
  highlighted: boolean;
  onClick: () => void;
}

function LocusMarker({ locus, ordinal, highlighted, onClick }: LocusMarkerProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    // Subtle bob so loci read as living anchors, not props.
    ref.current.position.y = locus.y + Math.sin(t * 1.5 + locus.id) * 0.08;
  });

  return (
    <group position={[locus.x, locus.y, locus.z]}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this is a Three.js mesh, not an HTML element */}
      <mesh
        ref={ref}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        castShadow
      >
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshStandardMaterial
          color={highlighted ? "#fbbf24" : "#3b82f6"}
          emissive={highlighted ? "#f59e0b" : "#1e40af"}
          emissiveIntensity={highlighted ? 0.8 : 0.4}
          metalness={0.2}
          roughness={0.4}
        />
      </mesh>
      <Text
        position={[0, 0.9, 0]}
        fontSize={0.35}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000"
      >
        {locus.label ?? `#${ordinal}`}
      </Text>
    </group>
  );
}

interface ControllerProps {
  mode: "build" | "review";
  cameraTarget?: [number, number, number];
}

function Controller({ mode, cameraTarget }: ControllerProps) {
  const { camera, gl } = useThree();
  const keys = useRef<{ [k: string]: boolean }>({});
  // Track explicit camera target via OrbitControls' lookAt invocation.
  const target = useRef(new THREE.Vector3(0, EYE_HEIGHT, 0));

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
    };
    const onUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    const dom = gl.domElement;
    dom.tabIndex = 0;
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [gl]);

  useEffect(() => {
    if (cameraTarget) {
      target.current.set(cameraTarget[0], cameraTarget[1], cameraTarget[2]);
    }
  }, [cameraTarget]);

  useFrame((_, delta) => {
    // WASD / ZQSD walking. Movement stays horizontal — eye height is locked.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3();
    right.crossVectors(forward, camera.up).normalize();

    const move = MOVE_SPEED * delta;
    let dx = 0;
    let dz = 0;
    if (keys.current.KeyW || keys.current.ArrowUp || keys.current.KeyZ) dz += 1;
    if (keys.current.KeyS || keys.current.ArrowDown) dz -= 1;
    if (keys.current.KeyA || keys.current.ArrowLeft || keys.current.KeyQ) dx -= 1;
    if (keys.current.KeyD || keys.current.ArrowRight) dx += 1;

    if (dx !== 0 || dz !== 0) {
      const moveDir = new THREE.Vector3();
      moveDir.addScaledVector(forward, dz);
      moveDir.addScaledVector(right, dx);
      moveDir.normalize().multiplyScalar(move);
      camera.position.x += moveDir.x;
      camera.position.z += moveDir.z;
      camera.position.y = EYE_HEIGHT;
    } else {
      // Lock eye level even when OrbitControls drags vertically — feels
      // less « space sim » and more « walking the rooms ».
      camera.position.y = EYE_HEIGHT;
    }
  });

  return (
    <OrbitControls
      enablePan={mode === "build"}
      enableZoom={mode === "build"}
      maxPolarAngle={Math.PI / 2 + 0.05}
      minDistance={1}
      maxDistance={20}
      target={target.current}
    />
  );
}
