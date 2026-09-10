import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  GameActions,
  GameSnapshot,
  PrizeDefinition,
  Quality,
} from "./game-core/types";
import { InputController } from "./input/controller";
import { Icon, PrizeIcon } from "./ui/Icons";
import { PrizeInteraction } from "./ui/PrizeInteraction";
import { Joystick } from "./ui/Joystick";
import "@fontsource-variable/outfit/wght.css";
import "./styles.css";

const PrizeViewer = lazy(() => import("./ui/PrizeViewer"));

type Panel = "collection" | "settings" | null;
interface Settings {
  quality: Quality;
  muted: boolean;
  volume: number;
}
const settingsKey = "lagarra.settings.v1";
const keyboardTutorialKey = "lagarra.keyboard-tutorial.v1";

function shouldShowKeyboardTutorial() {
  if (matchMedia("(pointer: coarse)").matches) return false;
  try {
    return localStorage.getItem(keyboardTutorialKey) !== "accepted";
  } catch {
    return true;
  }
}

function initialSettings(): Settings {
  const defaults: Settings = {
    quality: matchMedia("(pointer: coarse)").matches ? "balanced" : "high",
    muted: false,
    volume: 0.35,
  };
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) ?? "null");
    if (!value || typeof value !== "object") return defaults;
    return {
      quality:
        value.quality === "balanced" || value.quality === "high"
          ? value.quality
          : defaults.quality,
      muted: typeof value.muted === "boolean" ? value.muted : false,
      volume:
        typeof value.volume === "number" && Number.isFinite(value.volume)
          ? Math.min(1, Math.max(0, value.volume))
          : 0.35,
    };
  } catch {
    return defaults;
  }
}

function Modal({
  title,
  children,
  onClose,
  showClose = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  showClose?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      className="panel-dialog"
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        if (showClose) onClose();
        else event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="panel-inner">
        <div className="panel-heading">
          <h2>{title}</h2>
          {showClose && (
            <button
              className="icon-button"
              aria-label="Close panel"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function App({
  snapshot,
  actions,
  error,
  winReady = false,
}: {
  snapshot: GameSnapshot | null;
  actions: GameActions | null;
  error?: string | null;
  winReady?: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedPrize, setSelectedPrize] = useState<PrizeDefinition | null>(
    null,
  );
  const [showKeyboardTutorial, setShowKeyboardTutorial] = useState(
    shouldShowKeyboardTutorial,
  );
  const [storing, setStoring] = useState(false);
  const storingRef = useRef(false);
  const mounted = useRef(true);
  const [collectionReceipt, setCollectionReceipt] = useState(() => ({
    count: snapshot?.collected.length ?? 0,
    pulse: 0,
  }));
  const [settings, setSettings] = useState(initialSettings);
  const controller = useMemo(
    () => (actions ? new InputController(actions) : null),
    [actions],
  );
  const ready = snapshot?.state === "positioning" && Boolean(actions) && !error;
  const result = snapshot?.state === "result";
  const count = snapshot?.collected.length ?? 0;
  const canRefill =
    Boolean(actions) && !storing && (ready || (result && winReady));
  useEffect(() => {
    // Keep the badge unchanged while a won prize is being presented or stored.
    // Refill and reset still keep it in sync when there is no pending trophy.
    if (storing || snapshot?.lastPrize) return;
    setCollectionReceipt((current) =>
      current.count === count ? current : { ...current, count },
    );
  }, [count, snapshot?.lastPrize, storing]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => controller?.attach(), [controller]);
  useEffect(() => {
    controller?.setEnabled(ready && panel === null && !showKeyboardTutorial);
  }, [controller, ready, panel, showKeyboardTutorial]);
  useEffect(() => {
    actions?.setQuality(settings.quality);
  }, [actions, settings.quality]);
  useEffect(() => {
    actions?.setMuted(settings.muted);
  }, [actions, settings.muted]);
  useEffect(() => {
    actions?.setVolume(settings.volume);
  }, [actions, settings.volume]);
  useEffect(() => {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      /* Storage can be unavailable in a private session. */
    }
  }, [actions, settings]);
  const playAgain = async () => {
    if (storingRef.current || !actions || !winReady) return;
    storingRef.current = true;
    setStoring(true);
    try {
      await actions.playAgain();
      if (mounted.current)
        // One update makes the count and gift pulse appear in the same frame.
        setCollectionReceipt((current) => ({
          count,
          pulse: current.pulse + 1,
        }));
    } finally {
      storingRef.current = false;
      if (mounted.current) setStoring(false);
    }
  };
  const toggleMute = () =>
    setSettings((current) => ({ ...current, muted: !current.muted }));
  const acceptKeyboardTutorial = () => {
    try {
      localStorage.setItem(keyboardTutorialKey, "accepted");
    } catch {
      /* Storage can be unavailable in a private session. */
    }
    setShowKeyboardTutorial(false);
  };

  return (
    <main className="game-ui" aria-label="La Garra claw machine game">
      <header className="top-bar">
        <div className="brand" aria-label="La Garra">
          <span className="brand-symbol">
            <Icon name="claw" size={29} />
          </span>
        </div>
        <nav className="top-actions" aria-label="Game options">
          <button
            className="collection-button"
            onClick={() => {
              setSelectedPrize(null);
              setPanel("collection");
            }}
            disabled={storing}
            aria-label={`Your collection, ${collectionReceipt.count} prizes`}
          >
            <span
              key={collectionReceipt.pulse}
              className={
                collectionReceipt.pulse
                  ? "collection-received"
                  : "collection-symbol"
              }
            >
              <Icon name="collection" />
            </span>
            <span className="collection-word">Collection</span>
            <span className="collection-count">{collectionReceipt.count}</span>
          </button>
          <button
            className="icon-button sound-button"
            onClick={toggleMute}
            aria-label={settings.muted ? "Turn sound on" : "Mute sound"}
            aria-pressed={settings.muted}
          >
            <Icon name={settings.muted ? "mute" : "sound"} />
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel("settings")}
            disabled={storing}
            aria-label="Open settings"
          >
            <Icon name="settings" />
          </button>
        </nav>
      </header>

      {error ? (
        <div className="notice error-notice" role="alert">
          <h2>We could not start the game.</h2>
          <p>{error}</p>
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      ) : !snapshot ? (
        <div className="loading-note" role="status">
          <span className="loading-line" />
          <span>Loading the machine…</span>
        </div>
      ) : null}

      {result && winReady && snapshot.lastPrize && !panel && !storing && (
        <PrizeInteraction
          name={snapshot.lastPrize.name}
          className="win-prize-interaction"
          onRotate={(dx, dy) => actions?.rotatePrize(dx, dy)}
        />
      )}
      {result && winReady && snapshot.lastPrize && !panel && !storing && (
        <section
          className="result-note is-win"
          aria-label="Attempt result"
          aria-live="polite"
        >
          <div>
            <h2>Nice grab!</h2>
            <p>{snapshot.lastPrize.name} is in your collection.</p>
          </div>
          <button className="primary-button" onClick={playAgain}>
            Play again
          </button>
        </section>
      )}

      <div className="bottom-region">
        <div className="control-dock" aria-label="Machine controls">
          <Joystick
            controller={controller}
            disabled={!ready || panel !== null || showKeyboardTutorial}
          />
          <div className="view-control">
            <button
              className="view-button"
              aria-label="Change view"
              disabled={!ready || panel !== null || showKeyboardTutorial}
              onClick={() => actions?.switchCamera()}
            >
              <Icon name="camera" size={24} />
            </button>
          </div>
          <div className="drop-control">
            <button
              className="drop-button"
              disabled={!ready || panel !== null || showKeyboardTutorial}
              onClick={() => {
                controller?.clear();
                actions?.drop();
              }}
              aria-label="Drop claw"
            >
              <Icon name="claw" size={25} />
              <span>DROP</span>
            </button>
          </div>
        </div>
      </div>

      {showKeyboardTutorial && (
        <Modal
          title="How to play"
          onClose={acceptKeyboardTutorial}
          showClose={false}
        >
          <p className="panel-lead">
            Use the keyboard to control the claw. You can also use the on-screen
            controls.
          </p>
          <ul className="help-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Move the claw</h3>
                <p>Use WASD or the arrow keys to move across the machine.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Drop the claw</h3>
                <p>Press Space when you are over the prize you want.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Change the view</h3>
                <p>Press C to switch between the two camera angles.</p>
              </div>
            </li>
          </ul>
          <button
            className="primary-button full-width"
            onClick={acceptKeyboardTutorial}
          >
            Got it, let’s play
          </button>
        </Modal>
      )}

      {panel === "collection" && (
        <Modal
          title={selectedPrize?.name ?? "Your collection"}
          onClose={() => setPanel(null)}
        >
          {selectedPrize ? (
            <>
              <Suspense
                fallback={
                  <div
                    className="collection-prize-viewer viewer-loading"
                    role="status"
                  >
                    Loading prize…
                  </div>
                }
              >
                <PrizeViewer prize={selectedPrize} />
              </Suspense>
              <button
                className="text-button back-to-collection"
                onClick={() => setSelectedPrize(null)}
              >
                Back to collection
              </button>
            </>
          ) : count ? (
            <ul className="prize-grid">
              {snapshot?.collected.map((prize, i) => (
                <li key={`${prize.id}-${i}`}>
                  <button
                    className="prize-card"
                    aria-label={`View ${prize.name} in 3D`}
                    onClick={() => setSelectedPrize(prize)}
                  >
                    <PrizeIcon prize={prize} />
                    <strong>{prize.name}</strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-collection">
              <PrizeIcon ghost />
              <h3>No prizes yet</h3>
              <p>
                Land a prize in the chute
                <br />
                to add it to your collection.
              </p>
            </div>
          )}
          <button
            className="primary-button full-width"
            onClick={() => setPanel(null)}
          >
            Back to the machine
          </button>
        </Modal>
      )}
      {panel === "settings" && (
        <Modal title="Settings" onClose={() => setPanel(null)}>
          <div className="settings-row">
            <div>
              <h3>Sound</h3>
            </div>
            <button
              className={`toggle ${!settings.muted ? "is-on" : ""}`}
              role="switch"
              aria-checked={!settings.muted}
              aria-label="Sound"
              onClick={toggleMute}
            >
              <span />
            </button>
          </div>
          <div className="settings-row volume-row">
            <label htmlFor="volume">Volume</label>
            <input
              id="volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.volume}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  volume: Number(event.target.value),
                }))
              }
            />
            <span>{Math.round(settings.volume * 100)}%</span>
          </div>
          <div className="settings-block">
            <h3>Graphics quality</h3>
            <div
              className="segmented-control"
              role="group"
              aria-label="Graphics quality"
            >
              {(["balanced", "high"] as const).map((quality) => (
                <button
                  key={quality}
                  aria-pressed={settings.quality === quality}
                  onClick={() =>
                    setSettings((current) => ({ ...current, quality }))
                  }
                >
                  {quality === "balanced" ? "Balanced" : "High detail"}
                </button>
              ))}
            </div>
            <p>Balanced uses less power. High detail gives sharper shadows.</p>
          </div>
          <div className="settings-row refill-row">
            <div>
              <h3>Prize pile</h3>
              <p>Refill keeps your collected prizes.</p>
            </div>
            <button
              className="text-button"
              disabled={!canRefill}
              onClick={() => {
                actions?.refill();
                setPanel(null);
              }}
            >
              Refill machine
            </button>
          </div>
          {!canRefill && (
            <p className="panel-footnote">
              Refill is available when the claw stops.
            </p>
          )}
        </Modal>
      )}
    </main>
  );
}
