import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/HomeScreen';
import { Text } from 'react-native';

const Stack = createNativeStackNavigator();

export default function App() {
    return (
		<NavigationContainer>
			<Stack.Navigator screenOptions={{
				
			}}>
				<Stack.Screen name="Home" component={HomeScreen} options={{
					//header: () => {return <Text className='text-4xl text-[#515554]'>When did I last</Text>;},
					title: 'When did I last',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />
			</Stack.Navigator>
		</NavigationContainer>
    );
}