import React from "react";
import { Composition } from "remotion";
import { Main } from "./Main";
import { MainCuts } from "./MainCuts";

export const Root: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={450} fps={30} width={1920} height={1080} />
    <Composition id="Cuts" component={MainCuts} durationInFrames={450} fps={30} width={1920} height={1080} />
  </>
);
