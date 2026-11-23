// Seller Website v4 ("catalogue and slip") — is this shop drawn in the new look? The pages are the same
// components either way; a few of them draw an icon instead of an emoji, or one extra control, when it is on.
import { createContext, useContext } from "react";

export const NewLookCtx = createContext(false);
export const useNewLook = () => useContext(NewLookCtx);
