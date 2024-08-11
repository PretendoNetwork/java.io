import { registerClass } from '@/java-object-input-stream';
import type JavaObjectInputStream from '@/java-object-input-stream';
import type { JavaClassDescription } from '@/types/java';

export default class JavaBoolean {
	readObject(ois: JavaObjectInputStream, classDescription: JavaClassDescription) {
		ois.defaultReadObject(classDescription);
	}
}

registerClass('java.lang.Boolean', JavaBoolean);