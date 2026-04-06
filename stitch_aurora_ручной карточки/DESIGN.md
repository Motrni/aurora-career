# Editorial Design System: Soft-Touch Polymorphism

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Luminescent Archive."** 

This is not a standard functional UI; it is a high-end, editorial experience that treats digital space like a physical, illuminated gallery. We move beyond the "template" look by rejecting rigid grids in favor of **intentional asymmetry** and **polymorphic depth**. The goal is a "soft-touch" tactile feel—interfaces should look like they would feel like satin or frosted glass if touched. By layering tonal surfaces and using oversized, high-contrast typography, we create an environment that feels expensive, curated, and deeply modern.

---

## 2. Colors: The Tonal Spectrum
Our palette is rooted in deep, cosmic violets and obsidian foundations, accented by ethereal lavenders. 

### Palette Strategy
- **Background (`#15121c`):** The canvas. It is never pure black, but a deep, "inkwell" violet that provides more depth than a standard neutral.
- **Primary & Secondary (`#ccbeff`, `#5a30d0`):** These are used for "Light-Leak" accents. Use these to guide the eye, not to overwhelm.
- **Surface Hierarchy:** Utilize `surface-container-lowest` (`#100d17`) to `surface-container-highest` (`#37333e`) to create a sense of physical stacking.

### The "No-Line" Rule
**Explicit Instruction:** 1px solid borders for sectioning are strictly prohibited. 
Boundaries must be defined solely through background color shifts. To separate a section, transition from `surface` to `surface-container-low`. The human eye perceives the change in luminosity as a boundary, creating a cleaner, more sophisticated "soft-touch" transition than a hard line ever could.

### The "Glass & Gradient" Rule
To achieve a "Signature" look, floating elements (modals, navigation bars, dropdowns) must use **Glassmorphism**.
- **Recipe:** `surface-variant` at 40% opacity + 20px - 40px `backdrop-blur`.
- **Gradients:** Use subtle linear gradients (e.g., `primary` to `primary-container`) for CTAs. Avoid flat fills; a 10-degree tilt in a gradient adds the "soul" required for a premium feel.

---

## 3. Typography: Editorial Authority
We use **Inter** as our primary typeface, chosen for its exceptional Cyrillic support and its "Swiss-precision" aesthetic.

- **Display (Lg/Md/Sm):** These are your "Statement" tiers. Use `display-lg` (3.5rem) with tight tracking (-0.02em) to create a bold, editorial look. Overlap display text with images to break the grid.
- **Headlines & Titles:** These serve as the structural anchor. Ensure high contrast between `headline-lg` and `body-md` to maintain a clear information hierarchy.
- **Body & Labels:** Designed for maximum legibility. Use `on-surface-variant` (`#cac3d7`) for secondary body text to reduce visual noise and soften the overall UI.

The typography hierarchy conveys a brand that is **authoritative yet approachable**, blending professional clean lines with the rhythmic spacing of a luxury magazine.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are too "digital." We use **Ambient Physics** to create depth.

### The Layering Principle
Depth is achieved by "stacking" the surface tiers. Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a soft, natural "recessed" or "lifted" look without a single pixel of shadow.

### Ambient Shadows
When a floating effect is required (e.g., a primary Action Button), use:
- **Blur:** 30px to 60px.
- **Opacity:** 4% - 8%.
- **Tint:** The shadow must be tinted with the `primary` color, never pure black. This mimics how light interacts with colored surfaces in the real world.

### The "Ghost Border" Fallback
If accessibility requires a container edge, use a **Ghost Border**: `outline-variant` at 15% opacity. This provides a "suggestion" of an edge rather than a hard constraint.

---

## 5. Components: Soft-Touch Implementation

### Buttons
- **Primary:** Gradient fill (`primary-container` to `secondary-container`), `xl` roundedness (3rem), and a subtle inner-glow (1px top-stroke, 20% white).
- **Secondary:** Glassmorphism style. Semi-transparent surface with a `backdrop-blur`.

### Input Fields
- **Styling:** Forgo the box. Use a `surface-container-high` background with `none` border and `md` (1.5rem) corners. 
- **Active State:** Instead of a border change, use a soft glow (ambient shadow) in the `primary` color.

### Cards & Lists
- **The "No-Divider" Rule:** Forbid the use of 1px divider lines. Separate list items using vertical white space from the Spacing Scale (e.g., `spacing-4`) or by alternating between `surface-container-low` and `surface-container-lowest`.
- **Rounding:** All cards must use `lg` (2rem) or `xl` (3rem) corner radii to maintain the "polymorphic" soft feel.

### Additional Suggested Components
- **The "Blur-Glow" Cursor:** A large, low-opacity primary color orb that follows the mouse behind the UI layers, highlighting the glassmorphism effects as the user moves.
- **Micro-Progress Indicators:** Thin, gradient-filled bars that use `surface-tint` to show status without cluttering the editorial layout.

---

## 6. Do’s and Don’ts

### Do:
- **Do** use intentional asymmetry. Align text to the left but place imagery or floating "glass" elements off-center to create visual energy.
- **Do** lean into the "Soft-Touch" tactile feel by using the maximum `xl` roundedness on interactive elements.
- **Do** use the Spacing Scale aggressively. Luxury is defined by "wasted" space (breathing room).

### Don’t:
- **Don’t** use 1px solid lines. Ever. It breaks the "Luminescent Archive" illusion.
- **Don’t** use high-contrast white text on pure black. Use `on-surface` (`#e7e0ef`) on our deep violet background for a softer, more expensive feel.
- **Don’t** use standard "Material" or "Bootstrap" spacing. If a gap feels "normal," double it to make it "editorial."