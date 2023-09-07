import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './src/HomeScreen';
import { Pressable, Text, View } from 'react-native';
import CardEditScreen from './src/CardEditScreen';

import * as Linking from 'expo-linking';

import Icon from 'react-native-vector-icons/Feather';
import CardCreationScreen from './src/CardCreationScreen';

export type RootStackParams = {
	Home: any;
	CardEdit: {
		id: number,
	};
	CardCreation: any;
};

const RootStack = createNativeStackNavigator<RootStackParams>();

export default function App() {

    return (
		<NavigationContainer>
			<RootStack.Navigator screenOptions={{
				animation: 'default'
			}}>
				<RootStack.Screen name="Home" component={HomeScreen} options={{
					title: 'When did I last',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
					headerRight: () =>  {
						const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
						return(
							<View className='flex flex-row gap-10 mx-2'>
								<Pressable onPress={() => Linking.openURL('https://www.buymeacoffee.com/benediktw')}>
									<Icon name={'coffee'} size={25} />
								</Pressable>
								
								<Pressable onPress={() => navigation.navigate('CardCreation')}>
									<Icon name={'plus'} size={25} />
								</Pressable>
							</View>
						)
					},
				}} />

				<RootStack.Screen name="CardEdit" component={CardEditScreen} options={{
					title: 'Edit Card',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />

				<RootStack.Screen name="CardCreation" component={CardCreationScreen} options={{
					title: 'Create Card',
					headerStyle: { backgroundColor: '#F5EFB9' },
					headerTintColor: '#111',
					headerShadowVisible: false,
				}} />
			</RootStack.Navigator>
		</NavigationContainer>
    );
}