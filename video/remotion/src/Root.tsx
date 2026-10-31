import {Composition, Still} from 'remotion';
import {ChalkDemo, Thumbnail} from './Video';
import {edit, FPS} from './edit';

export const Root = () => (
  <>
    <Composition
      id="ChalkDemo"
      component={ChalkDemo}
      durationInFrames={Math.ceil(edit.duration * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
  </>
);
